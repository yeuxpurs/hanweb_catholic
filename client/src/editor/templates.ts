import { normalizePageSettings, type PageSettings } from "./document";

export interface DocumentTemplate {
  id: string;
  title: string;
  description: string;
  content: string;
  pageSettings: PageSettings;
}

const settings = (header = ""): PageSettings => normalizePageSettings({
  margins: { top: 20, right: 22, bottom: 20, left: 22 },
  header,
  pageNumbers: true,
});

/** Editable starting points, with placeholders instead of invented parish details. */
export const DOCUMENT_TEMPLATES: readonly DocumentTemplate[] = [
  {
    id: "blank",
    title: "빈 문서",
    description: "자유롭게 작성하는 기본 A4 문서",
    content: "<p></p>",
    pageSettings: normalizePageSettings(),
  },
  {
    id: "meeting",
    title: "회의록",
    description: "안건, 결정 사항, 담당자와 기한을 기록",
    pageSettings: settings("회의록"),
    content: `<h1 style="text-align:center">[회의 이름] 회의록</h1>
      <p><strong>일시:</strong> [날짜와 시간]　<strong>장소:</strong> [장소]</p>
      <p><strong>참석:</strong> [참석자]　<strong>작성:</strong> [작성자]</p>
      <h2>1. 안건</h2><ol><li><p>[첫 번째 안건]</p></li><li><p>[두 번째 안건]</p></li></ol>
      <h2>2. 논의 및 결정 사항</h2>
      <table><tbody><tr><th><p>안건</p></th><th><p>논의 내용</p></th><th><p>결정 사항</p></th></tr>
      <tr><td><p>[안건]</p></td><td><p>[주요 의견]</p></td><td><p>[결정 내용]</p></td></tr></tbody></table>
      <h2>3. 후속 작업</h2>
      <table><tbody><tr><th><p>작업</p></th><th><p>담당자</p></th><th><p>완료 기한</p></th></tr>
      <tr><td><p>[할 일]</p></td><td><p>[담당]</p></td><td><p>[기한]</p></td></tr></tbody></table>
      <h2>4. 다음 모임</h2><p>[다음 일정과 준비 사항]</p>`,
  },
  {
    id: "bulletin",
    title: "본당 주보",
    description: "미사 안내, 공동체 소식과 한 주의 일정을 정리",
    pageSettings: settings("[본당 이름] · 주보"),
    content: `<h1 style="text-align:center">[본당 이름] 주보</h1>
      <p style="text-align:center">[발행일] · [주보 호수] · [주일 / 전례일]</p>
      <h2>이번 주 말씀과 나눔</h2><p>[성경 구절의 출처와 나눔 내용을 작성하세요.]</p>
      <h2>미사 및 모임 안내</h2>
      <table><tbody><tr><th><p>날짜</p></th><th><p>시간</p></th><th><p>미사 / 모임</p></th><th><p>장소</p></th></tr>
      <tr><td><p>[날짜]</p></td><td><p>[시간]</p></td><td><p>[미사 또는 모임]</p></td><td><p>[장소]</p></td></tr>
      <tr><td><p>[날짜]</p></td><td><p>[시간]</p></td><td><p>[미사 또는 모임]</p></td><td><p>[장소]</p></td></tr></tbody></table>
      <h2>공동체 소식</h2><ul><li><p><strong>[소식 제목]</strong> — [안내 내용]</p></li><li><p><strong>[모집 / 행사]</strong> — [신청 방법과 기한]</p></li></ul>
      <h2>이번 주 함께할 일</h2><p>[공동체가 함께 실천할 내용을 작성하세요.]</p>
      <p><strong>문의:</strong> [사무실 연락처 / 운영 시간]</p>`,
  },
  {
    id: "notice",
    title: "행사 안내문",
    description: "행사 목적, 시간, 장소와 신청 정보를 한 장에",
    pageSettings: settings(),
    content: `<h1 style="text-align:center">[행사 이름] 안내</h1>
      <p>[행사의 목적과 초대 말씀을 작성하세요.]</p>
      <table><tbody><tr><th><p>일시</p></th><td><p>[날짜와 시간]</p></td></tr>
      <tr><th><p>장소</p></th><td><p>[장소 / 주소]</p></td></tr>
      <tr><th><p>대상</p></th><td><p>[참가 대상]</p></td></tr>
      <tr><th><p>신청</p></th><td><p>[신청 방법 / 마감일]</p></td></tr>
      <tr><th><p>준비물</p></th><td><p>[준비 사항]</p></td></tr>
      <tr><th><p>문의</p></th><td><p>[담당자 / 연락처]</p></td></tr></tbody></table>
      <h2>진행 순서</h2><ol><li><p>[첫 번째 순서]</p></li><li><p>[두 번째 순서]</p></li><li><p>[마무리]</p></li></ol>
      <h2>참가 안내</h2><p>[접근성, 이동, 우천 시 운영 등 필요한 안내]</p>
      <p style="text-align:right">[주최 / 주관]</p>`,
  },
  {
    id: "program",
    title: "전례 · 프로그램 준비표",
    description: "순서, 담당, 준비물과 확인 사항을 협의하며 작성",
    pageSettings: settings("전례 · 프로그램 준비표"),
    content: `<h1>[전례 / 프로그램 이름] 준비표</h1>
      <p><strong>일시:</strong> [날짜와 시간]　<strong>장소:</strong> [장소]</p>
      <p><strong>담당:</strong> [총괄 담당자]　<strong>참여 대상:</strong> [대상]</p>
      <h2>준비 방향</h2><p>[목적과 진행 시 유의할 점]</p>
      <h2>진행 계획</h2>
      <table><tbody><tr><th><p>시간 / 순서</p></th><th><p>내용</p></th><th><p>담당</p></th><th><p>준비물</p></th></tr>
      <tr><td><p>[시간]</p></td><td><p>[순서와 내용]</p></td><td><p>[담당자]</p></td><td><p>[자료 / 준비물]</p></td></tr>
      <tr><td><p>[시간]</p></td><td><p>[순서와 내용]</p></td><td><p>[담당자]</p></td><td><p>[자료 / 준비물]</p></td></tr>
      <tr><td><p>[시간]</p></td><td><p>[순서와 내용]</p></td><td><p>[담당자]</p></td><td><p>[자료 / 준비물]</p></td></tr></tbody></table>
      <h2>사전 확인</h2><ul><li><p>[참여자 및 담당자 일정 확인]</p></li><li><p>[공간, 음향, 인쇄물 확인]</p></li><li><p>[사용할 전례문과 자료는 본당의 담당자 및 공식 자료로 확인]</p></li></ul>
      <h2>진행 후 기록</h2><p>[참여 현황, 평가 및 다음 준비 사항]</p>`,
  },
  {
    id: "letter",
    title: "공문 · 협조 요청",
    description: "수신, 제목, 요청 사항과 붙임을 갖춘 문서",
    pageSettings: settings("[발신 기관 / 단체]"),
    content: `<h1 style="text-align:center">[발신 기관 / 단체 이름]</h1>
      <p><strong>문서 번호:</strong> [문서 번호]　<strong>시행일:</strong> [날짜]</p>
      <p><strong>수신:</strong> [수신 기관 / 담당자]</p><p><strong>참조:</strong> [참조 대상]</p>
      <h2>제목: [협조 요청 제목]</h2>
      <p>1. [인사 및 문서를 보내는 배경]</p><p>2. [요청 목적과 주요 내용]</p>
      <table><tbody><tr><th><p>요청 사항</p></th><td><p>[구체적인 요청 내용]</p></td></tr>
      <tr><th><p>회신 기한</p></th><td><p>[날짜와 시간]</p></td></tr>
      <tr><th><p>회신 방법</p></th><td><p>[담당자 / 연락처 / 이메일]</p></td></tr></tbody></table>
      <p>3. [추가 안내와 협조에 대한 감사]</p>
      <p><strong>붙임:</strong> [첨부 자료명] [부수]. 끝.</p>
      <p style="text-align:center"><strong>[발신 기관 / 단체장]</strong></p>
      <p><strong>담당:</strong> [이름]　<strong>연락처:</strong> [연락처]</p>`,
  },
];

export function createTemplateDocument(id: string): { content: string; fileName: string; pageSettings: PageSettings } {
  const template = DOCUMENT_TEMPLATES.find(item => item.id === id);
  if (!template) throw new Error("선택한 서식을 찾을 수 없습니다.");
  return {
    content: template.content,
    fileName: template.id === "blank" ? "새 문서" : template.title,
    pageSettings: normalizePageSettings(template.pageSettings),
  };
}
