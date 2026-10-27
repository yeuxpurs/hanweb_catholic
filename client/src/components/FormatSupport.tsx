export default function FormatSupport({onClose}:{onClose:()=>void}) {
  return <div className="recovery-backdrop no-print"><section className="recovery-panel format-support" role="dialog" aria-modal="true" aria-label="파일 지원 범위">
    <div className="panel-heading"><h2>파일 지원 범위</h2><button onClick={onClose}>닫기</button></div>
    <table><thead><tr><th>형식</th><th>불러오기·편집</th><th>저장·출력</th></tr></thead><tbody>
      <tr><th>HWPX</th><td>주요 서식·표·그림·용지. 복잡한 개체는 제한됨.</td><td>실제 HWPX 생성. HanWeb 재열기는 편집 상태 포함. 외부 머리말·꼬리말·쪽 나누기 등 제한.</td></tr>
      <tr><th>HWP</th><td>텍스트 전용 / HWPX 상세 변환 시도. 실제 원본 호환성 미검증.</td><td>HWP 저장 미지원. HWPX·DOCX로 내보내기.</td></tr>
      <tr><th>DOCX</th><td>주요 글자·문단 서식, 목록, 병합 표, 그림, 단일 용지 설정.</td><td>실제 OOXML, 텍스트 캡션·머리말·꼬리말·쪽 번호. LibreOffice 열기 확인. Word 표시 결과 미검증.</td></tr>
      <tr><th>DOC</th><td>미지원</td><td>미지원</td></tr>
      <tr><th>PDF</th><td>Chrome·Edge 원본 보기·검색·배율·쪽 이동. 본문 편집·OCR 미지원.</td><td>실제 쪽 미리보기 후 브라우저 인쇄의 ‘PDF로 저장’. 텍스트 선택·검색 확인.</td></tr>
      <tr><th>TXT</th><td>UTF-8 텍스트·빈 줄을 불러옵니다.</td><td>UTF-8 텍스트 다운로드. 글자 서식·그림·표 구조는 포함하지 않습니다.</td></tr>
      <tr><th>HTML</th><td>본문·주요 인라인 서식·표·내장 그림. 스크립트와 외부 자원은 제외합니다.</td><td>독립 HTML 문서 다운로드. 복잡한 웹페이지 기능과 정확한 쪽 배치는 보존하지 않습니다.</td></tr>
      <tr><th>HanWeb 백업</th><td>전체 편집 상태·용지 설정 재열기.</td><td>.hanweb JSON 다운로드. 다른 문서 프로그램에서 여는 형식이 아닙니다.</td></tr>
    </tbody></table>
    <p>외부 프로그램에서는 글꼴·줄바꿈이 달라질 수 있습니다. 변환 안내를 확인하고 원본과 백업을 보관하세요.</p>
    <p>자동 저장과 복구본은 이 브라우저의 저장소에 보관됩니다. 기기 간 동기화는 제공하지 않습니다.</p>
  </section></div>;
}
