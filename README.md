# 세액계산기

브라우저에서 index.html 을 열면 바로 동작한다 (서버, 빌드 불필요).

## 폴더 구조

    index.html                 화면 뼈대, 스크립트 로드 순서
    css/style.css              스타일 (라이트·다크 모드)
    js/namespace.js            global namespace : TAX
    js/data/tax-tables.js      세율표·공제 기준 (세법 개정 시 이 파일만 고친다)
    js/data/rates-db.js        2025년 귀속 단순·기준경비율 1,542개 업종
    js/common/util.js          숫자·날짜·누진세 계산 공통 함수
    js/common/ui.js            상태 저장, 입력 위젯, 계산서 렌더링
    js/tax/income.js           종합소득세 (계산 + 입력 화면 + 계산서)
    js/tax/realty.js           양도소득세 부동산
    js/tax/stock.js            양도소득세 주식
    js/tax/gift.js             증여세
    js/tax/inheritance.js      상속세
    js/tax/corp.js             법인세 (법인지방소득세, 농어촌특별세 포함)
    js/tax/acquisition.js      취득세 (농어촌특별세, 지방교육세 포함)
    js/app.js                  탭 전환, 입력 이벤트, 초기화

스크립트는 index.html 에 적힌 순서(namespace → 데이터 → 공통 → 세목 → app)대로 불러와야 한다.
모든 파일은 전역 객체 TAX 하나에 붙는다 (TAX.tables, TAX.util, TAX.ui, TAX.views.<세목>).

## 세목 파일 구조

각 세목 파일은 TAX.views.<세목> 에 아래 함수를 등록한다.

    calc(state)     세액 계산 (화면과 무관한 순수 계산)
    example()       엑셀 예시값
    blank()         빈 입력값
    form(state)     입력 화면 HTML
    sheet(state)    계산서 HTML과 최종 금액
