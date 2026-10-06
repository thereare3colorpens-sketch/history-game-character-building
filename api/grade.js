const gradeSchema = {
  type: "object",
  properties: {
    details: {
      type: "object",
      properties: {
        historicalAccuracy: { type: "number", minimum: 0, maximum: 4, multipleOf: 0.5 },
        linkage: { type: "number", minimum: 0, maximum: 3, multipleOf: 0.5 },
        interpretation: { type: "number", minimum: 0, maximum: 2, multipleOf: 0.5 },
        clarity: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.5 }
      },
      required: ["historicalAccuracy", "linkage", "interpretation", "clarity"],
      additionalProperties: false
    },
    strengths: { type: "array", items: { type: "string" } },
    improvements: { type: "array", items: { type: "string" } },
    teacherReviewNeeded: { type: "boolean" },
    teacherReviewNote: { type: "string" }
  },
  required: ["details", "strengths", "improvements", "teacherReviewNeeded", "teacherReviewNote"],
  additionalProperties: false
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

async function verifyTeacher(request) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) throw new Error("교사 로그인 토큰이 없습니다.");
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  const adminEmail = String(process.env.ADMIN_EMAIL || "").toLowerCase();
  if (!apiKey || !adminEmail) throw new Error("Vercel 환경변수 FIREBASE_WEB_API_KEY 또는 ADMIN_EMAIL이 없습니다.");

  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: token })
  });
  if (!r.ok) throw new Error("교사 로그인 확인에 실패했습니다.");
  const data = await r.json();
  const email = String(data.users?.[0]?.email || "").toLowerCase();
  if (!email || email !== adminEmail) throw new Error("등록된 교사 계정이 아닙니다.");
  return email;
}

function outputText(data) {
  for (const item of data.output || []) {
    for (const c of item.content || []) {
      if (c.type === "output_text" && c.text) return c.text;
    }
  }
  return "";
}

export default {
  async fetch(request) {
    if (request.method !== "POST") return json({ error: "POST 요청만 허용됩니다." }, 405);
    try {
      await verifyTeacher(request);
      if (!process.env.OPENAI_API_KEY) return json({ error: "Vercel 환경변수 OPENAI_API_KEY가 설정되지 않았습니다." }, 500);

      const packet = await request.json();
      const model = process.env.OPENAI_MODEL || "gpt-6-luna";
      const instructions = [
        "당신은 대한민국 중학교 역사 수행평가의 교사용 보조 채점자입니다.",
        "이 활동의 목적은 역사 인물의 전기를 많이 아는지 평가하는 것이 아니라, 인물과 연결된 핵심 역사 사건을 이해하고 역사적 사실을 게임의 기술·능력치로 논리적으로 번역하는지 평가하는 것입니다.",
        "총 10점 루브릭: 역사 사건·사실의 정확성 4점, 역사 사실과 게임 요소의 연결성 3점, 역사적 해석의 타당성·균형 2점, 설명의 완성도·명료성 1점.",
        "점수는 0.5점 단위로 부여하세요. 학생의 창의성 자체보다 역사적 근거와 연결 논리를 우선하세요.",
        "학생이 교과서 수준을 넘어선 세부 사실을 적어 확신하기 어려우면 억지로 감점하지 말고 teacherReviewNeeded=true로 표시하세요.",
        "이미지 첨부 여부, 그림의 미적 완성도, 화면 이탈이나 붙여넣기 기록은 평가하지 마세요.",
        "정치적·도덕적 평가를 현재의 관점으로 단정하지 말고 해당 시대와 수업 맥락에서 판단하세요.",
        packet.referenceGuide ? `교사 참고 기준:\n${packet.referenceGuide}` : ""
      ].filter(Boolean).join("\n");

      const body = {
        model,
        reasoning: { effort: "low" },
        instructions,
        input: JSON.stringify({
          activity: { academicYear: packet.academicYear, title: packet.activityTitle },
          student: packet.student,
          eventStudy: packet.eventStudy,
          gameElements: packet.gameElements
        }),
        max_output_tokens: 1400,
        text: {
          format: {
            type: "json_schema",
            name: "history_character_grade",
            strict: true,
            schema: gradeSchema
          }
        }
      };

      const r = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
      const data = await r.json();
      if (!r.ok) return json({ error: data?.error?.message || "OpenAI API 호출에 실패했습니다." }, r.status);

      const text = outputText(data);
      if (!text) return json({ error: "AI 응답에서 평가 JSON을 찾지 못했습니다." }, 500);
      const result = JSON.parse(text);
      const d = result.details || {};
      const totalScore = [d.historicalAccuracy, d.linkage, d.interpretation, d.clarity].reduce((a, b) => a + Number(b || 0), 0);
      return json({ ...result, totalScore, model });
    } catch (e) {
      console.error(e);
      return json({ error: e.message || "AI 평가 중 오류가 발생했습니다." }, 500);
    }
  }
};
