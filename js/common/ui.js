/* 공통 화면: 상태 저장소, 입력 위젯, 계산서 렌더러 */
(function (TAX) {
  const U = TAX.util;
  const UI = (TAX.ui = {});

  /* 상태: TAX.state.<세목>.<필드> 경로 문자열로 읽고 쓴다 (예: "realty.items.0.salePrice") */
  TAX.state = {};
  // tax.state (화면입력된 모든 변수값 집합)에서 세목.필드 값을 읽는다
  // reduce 함수를 이용하면 객체 속 객체로 계속파고들 수 있음
  UI.get = (path) =>
    path.split(".").reduce((o, k) => (o == null ? o : o[k]), TAX.state);
  // 마지막직전까지 객체를 읽어온뒤, 마지막에 있는 필드명을 key값으로 하는 value값저장한다
  UI.set = (path, val) => {
    const ks = path.split(".");
    const last = ks.pop(); //필드명
    ks.reduce((o, k) => o[k], TAX.state)[last] = val;
  };

  /* 입력 위젯 */
  UI.money = (p, label, hint) => {
    const v = UI.get(p) || 0;
    return `<label class="f"><span class="l">${label}</span>
      <span class="in"><input class="won" inputmode="numeric" autocomplete="off" data-p="${p}" data-t="money" value="${v ? U.won(v) : ""}" placeholder="0"><i>원</i></span>
      <small class="kr" data-kr="${p}">${v ? U.korWon(v) : hint || ""}</small></label>`;
  };
  // 음수 가능 금액 (당기순손실 등): 앞에 - 를 입력한다
  UI.smoney = (p, label, hint) => {
    const v = UI.get(p) || 0;
    return `<label class="f"><span class="l">${label}</span>
      <span class="in"><input class="won" inputmode="text" autocomplete="off" data-p="${p}" data-t="smoney" value="${v ? (v < 0 ? "-" : "") + Math.abs(v).toLocaleString("ko-KR") : ""}" placeholder="0"><i>원</i></span>
      <small class="kr" data-kr="${p}">${v ? U.korWon(v) : hint || ""}</small></label>`;
  };
  UI.count = (p, label, unit = "명") =>
    `<label class="f"><span class="l">${label}</span>
      <span class="in"><input inputmode="numeric" data-p="${p}" data-t="int" value="${UI.get(p) || 0}"><i>${unit}</i></span><small></small></label>`;
  // 소수 입력 (세율 % 등)
  UI.num = (p, label, unit = "") =>
    `<label class="f"><span class="l">${label}</span>
      <span class="in"><input inputmode="decimal" autocomplete="off" data-p="${p}" data-t="num" value="${UI.get(p) || ""}" placeholder="0"><i>${unit}</i></span><small></small></label>`;
  // 날짜: 숫자 8자리를 입력하면 yyyy-mm-dd 로 바뀐다
  UI.date = (p, label, hint) => {
    const v = UI.get(p) || "";
    return `<label class="f"><span class="l">${label}</span>
      <span class="in"><input class="date" inputmode="numeric" autocomplete="off" maxlength="10" placeholder="yyyy-mm-dd" data-p="${p}" data-t="date" data-hint="${U.esc(hint || "")}" value="${U.esc(v)}"></span>
      <small data-dmsg="${p}">${UI.dateMsg(v, hint)}</small></label>`;
  };
  UI.dateMsg = (v, hint) => {
    if (!v) return hint || "숫자 8자리 (예: 20260530)";
    if (v.length < 10) return "숫자 8자리를 모두 입력한다";
    return U.isDate(v) ? hint || "" : "없는 날짜다";
  };
  UI.sel = (p, label, opts, rerender) => {
    const cur = UI.get(p);
    const v = String(cur);
    return `<label class="f"><span class="l">${label}</span>
      <span class="in"><select data-p="${p}" data-t="${typeof cur === "boolean" ? "bool" : "str"}"${rerender ? ' data-rerender="1"' : ""}>
      ${opts.map(([k, t]) => `<option value="${k}"${String(k) === v ? " selected" : ""}>${t}</option>`).join("")}</select></span><small></small></label>`;
  };
  UI.chk = (p, label, rerender) =>
    `<label class="f chk"><input type="checkbox" data-p="${p}" data-t="check"${UI.get(p) ? " checked" : ""}${rerender ? ' data-rerender="1"' : ""}><span>${label}</span></label>`;
  UI.text = (p, label) =>
    `<label class="f"><span class="l">${label}</span><span class="in"><input data-p="${p}" data-t="str" value="${U.esc(UI.get(p) || "")}"></span><small></small></label>`;
  UI.blankCell = () => '<span class="f spacer" aria-hidden="true"></span>';

  /* 묶음 */
  UI.group = (title, inner, extra = "") =>
    `<fieldset><legend>${title}</legend><div class="grid">${inner}</div>${extra}</fieldset>`;
  /// UI.group2 는 details/summary 태그를 이용한 접이식 묶음
  UI.group2 = (title, inner, extra = "") =>
    `<details><summary class="group-summary">${title}</summary><div class="grid">${inner}</div>${extra}</details>`;
  UI.intro = (tab, title, desc) =>
    `<div class="intro"><div><h2>${title}</h2><p>${desc}</p></div>
     <div class="tools"><button class="btn" type="button" data-act="example" data-tab="${tab}">예시값</button>
     <button class="btn" type="button" data-act="clear" data-tab="${tab}">모두 지우기</button></div></div>`;
  UI.basis = (items) =>
    `<details class="basis"><summary>계산 기준 등 설명</summary><ul>${items.map((t) => `<li>${t}</li>`).join("")}</ul></details>`;
  UI.item = (title, listPath, i, inner, editableTitlePath) =>
    `<div class="item"><div class="item-h">${
      editableTitlePath
        ? `<input data-p="${editableTitlePath}" data-t="str" value="${U.esc(title)}" aria-label="이름">`
        : `<span class="item-t">${title}</span>`
    }
      <button class="btn ghost" type="button" data-act="del" data-list="${listPath}" data-i="${i}">삭제</button></div>${inner}</div>`;
  UI.item2 = (title, listPath, i, inner, titlePath) =>
    `<div class="item"><div class="item-h">${
      titlePath
        ? `<span data-p="${titlePath}" data-t="str" value="${U.esc(title)}" aria-label="이름">${U.esc(title)}</span>`
        : `<span class="item-t">${title}</span>`
    }
      <button class="btn ghost" type="button" data-act="del" data-list="${listPath}" data-i="${i}">삭제</button></div>${inner}</div>`;
  UI.layout = (form, tab) =>
    `<div class="calc"><div class="form">${form}</div><aside class="sheet" id="sheet-${tab}"></aside></div>`;

  /* 계산서 */
  UI.R = (k, v, cls = "", x = "") => ({ k, v, cls, x });
  UI.sheet = ({ title, cap, rows, totalLabel, total, msgs = [], pre = "" }) => {
    const body = rows
      .map((r) =>
        r.cls === "head"
          ? `<div class="r head"><span class="k">${r.k}</span></div>`
          : `<div class="r ${r.cls}"><span class="k">${r.k}${r.x ? `<span class="x">${r.x}</span>` : ""}</span><span class="v">${typeof r.v === "number" ? U.won(r.v) : r.v}</span></div>`,
      )
      .join("");
    return `<h3>${title}</h3><p class="cap">${cap}</p>${pre}${body}
      <div class="total"><div class="k">${totalLabel}</div><div class="v">${U.won(total)}원</div><div class="kr">${U.korWon(total)}</div></div>
      ${msgs.map((m) => `<div class="msg">${m}</div>`).join("")}`;
  };
})((globalThis.TAX = globalThis.TAX || {}));
