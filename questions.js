// =====================================================
//  퀴즈 설정 & 문제 (관리자 페이지에서만 불러옵니다)
//  문제를 고치고 싶으면 이 파일만 수정하면 돼요.
// =====================================================

export const SCHOOL_NAME = "대진전자통신고등학교";
export const CLUB_NAME = "정보기술전공심화 동아리";

export const ADMIN_PASSWORD = "1234"; // 관리자 페이지 비밀번호
export const QUESTION_TIME = 20;      // 문제당 제한시간(초)
export const REVEAL_SECONDS = 8;      // 정답 공개 화면 유지 시간(초, 자동 진행일 때)

// type: "mc" = 4지선다, "ox" = O/X
// answer: 정답 번호 (0부터 시작) — O/X는 0 = O, 1 = X
export const QUESTIONS = [
  // ---------- 우리 동아리 ----------
  {
    type: "mc",
    q: "우리 기능부의 풀 네임은?",
    options: ["정보통신전공심화 동아리", "정보기술전공심화 동아리", "전자기술전공심화 동아리", "소프트웨어전공심화 동아리"],
    answer: 1,
  },
  {
    type: "mc",
    q: "우리 동아리실은 몇 층에 있을까?",
    options: ["1층", "2층", "3층", "4층"],
    answer: 1,
  },
  {
    type: "mc",
    q: "우리 동아리 지도 선생님의 성함은?",
    options: ["설진석 선생님", "서진성 선생님", "설진성 선생님", "설지성 선생님"],
    answer: 2,
  },
  {
    type: "mc",
    q: "우리 동아리가 주로 하는 활동은?",
    options: ["대회 출전 · 프로젝트 출전", "교내 게임 대회 개최", "밴드 공연", "교내 방송 촬영"],
    answer: 0,
  },
  {
    type: "mc",
    q: "우리 동아리의 현재 부원 수는?",
    options: ["3명", "4명", "5명", "7명"],
    answer: 2,
  },
  {
    type: "ox",
    q: "우리 동아리는 부원이 10명이 넘는 대형 동아리다!",
    answer: 1,
  },

  // ---------- AI 상식 ----------
  {
    type: "mc",
    q: "AI는 무엇의 줄임말일까?",
    options: ["Automatic Information", "Artificial Intelligence", "Advanced Internet", "Auto Interface"],
    answer: 1,
  },
  {
    type: "ox",
    q: "머신러닝(기계학습)은 인공지능의 한 분야이다.",
    answer: 0,
  },
  {
    type: "mc",
    q: "2016년 이세돌 9단과 바둑 대결을 펼친 구글 딥마인드의 AI는?",
    options: ["왓슨", "딥블루", "알파고", "시리"],
    answer: 2,
  },
  {
    type: "mc",
    q: "ChatGPT를 만든 회사는?",
    options: ["구글", "OpenAI", "삼성전자", "메타"],
    answer: 1,
  },
  {
    type: "ox",
    q: "AI가 사실이 아닌 내용을 진짜처럼 그럴듯하게 지어내는 현상을 '할루시네이션'이라고 한다.",
    answer: 0,
  },
  {
    type: "mc",
    q: "사람 뇌의 신경세포(뉴런) 구조를 본떠 만든 AI 모델은?",
    options: ["인공신경망", "블록체인", "관계형 데이터베이스", "운영체제"],
    answer: 0,
  },
];
