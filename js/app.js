/* 앱: 탭 전환, 입력 이벤트, 계산서 갱신 */
(function (TAX) {
  const U = TAX.util,
    UI = TAX.ui,
    V = TAX.views;
  const ORDER = [
    "income",
    "realty",
    "stock",
    "gift",
    "inheritance",
    "corp",
    "acquisition",
  ];
  let current = "income";

  ORDER.forEach((tab) => {
    TAX.state[tab] = V[tab].example();
  });

  const tabOf = (path) => path.split(".")[0];
  const $ = (sel) => document.querySelector(sel);

  // details를 구분하는 이름: data-key가 있으면 그것, 없으면 summary 글자
  const detailsKey = (d) =>
    d.dataset.key || (d.querySelector("summary")?.textContent || "").trim();

  function renderForm(tab) {
    //document.getElementById("v-" + tab).innerHTML = V[tab].form(TAX.state[tab]);
    //renderSheet(tab);
    const view = document.getElementById("v-" + tab);
    // 다시 그리기 전에 펼쳐져 있던 details를 기억한다
    const opened = new Set(
      [...view.querySelectorAll("details[open]")].map(detailsKey),
    );
    view.innerHTML = V[tab].form(TAX.state[tab]);
    // 같은 이름의 details를 다시 펼친다
    view.querySelectorAll("details").forEach((d) => {
      if (opened.has(detailsKey(d))) d.open = true;
    });
    renderSheet(tab);
  }

  //세액계산서(세액계산결과) 렌더링
  function renderSheet(tab) {
    let out;
    try {
      out = V[tab].sheet(TAX.state[tab]);
    } catch (e) {
      console.error(e);
      out = {
        html: '<p class="cap">입력값을 확인한다.</p>',
        label: "",
        total: 0,
      };
    }

    //계산서 tag
    const el = document.getElementById("sheet-" + tab);
    if (el) el.innerHTML = out.html;
    if (V[tab].sync && out.result) V[tab].sync(out.result); // 자동 계산값을 입력 칸에 반영
    if (tab === current) {
      $("#bar-k").textContent = out.label;
      $("#bar-v").textContent = U.won(out.total) + "원";
    }
  }
  function show(tab) {
    if (!V[tab]) tab = "income";
    current = tab;
    document.querySelectorAll(".view").forEach((v) => {
      v.hidden = v.dataset.tab !== tab;
    });
    document.querySelectorAll("nav.tabs a").forEach((a) => {
      const on = a.getAttribute("href") === "#" + tab;
      if (on) {
        a.setAttribute("aria-current", "page");
        a.scrollIntoView({ block: "nearest", inline: "nearest" });
      } else a.removeAttribute("aria-current");
    });
    renderSheet(tab);
  }

  /* 입력값 읽기 (커서 위치 유지) */
  function keepCaret(el, text, digitsBefore) {
    el.value = text;
    let i = 0,
      seen = 0;
    while (i < text.length && seen < digitsBefore) {
      if (/\d/.test(text[i])) seen++;
      i++;
    }
    try {
      el.setSelectionRange(i, i);
    } catch (e) {
      /* 일부 브라우저 */
    }
  }
  const digitsBeforeCaret = (el) =>
    el.value.slice(0, el.selectionStart || 0).replace(/\D/g, "").length;

  function readValue(el) {
    const t = el.dataset.t;
    if (t === "money") {
      const before = digitsBeforeCaret(el);
      const digits = el.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
      keepCaret(
        el,
        digits ? Number(digits).toLocaleString("ko-KR") : "",
        before,
      );
      return digits ? Number(digits) : 0;
    }
    if (t === "smoney") {
      // 음수 허용 금액: 맨 앞의 - (또는 −) 하나만 부호로 인정한다
      const before = digitsBeforeCaret(el);
      const neg = /^\s*[-−]/.test(el.value);
      const digits = el.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
      const body = digits ? Number(digits).toLocaleString("ko-KR") : "";
      keepCaret(el, (neg ? "-" : "") + body, before);
      if (neg && before === 0) el.setSelectionRange(1, 1);
      return digits ? (neg ? -1 : 1) * Number(digits) : 0;
    }
    if (t === "ovmoney") {
      // 직접 수정 가능한 자동 계산 칸: 비우면 null(자동 계산)로 되돌린다
      const before = digitsBeforeCaret(el);
      const digits = el.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
      keepCaret(
        el,
        digits ? Number(digits).toLocaleString("ko-KR") : "",
        before,
      );
      return digits ? Number(digits) : null;
    }
    if (t === "date") {
      const before = digitsBeforeCaret(el);
      const text = U.formatDateDigits(el.value); // 20260530 → 2026-05-30
      keepCaret(el, text, before);
      const msg = document.querySelector(`[data-dmsg="${el.dataset.p}"]`);
      if (msg) msg.textContent = UI.dateMsg(text, el.dataset.hint);
      return text;
    }
    if (t === "num") {
      // 숫자와 소수점 하나만 남긴다 (예: 16.5)
      let v = el.value.replace(/[^\d.]/g, "");
      const dot = v.indexOf(".");
      if (dot >= 0)
        v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, "");
      if (v !== el.value) el.value = v;
      const f = parseFloat(v);
      return isNaN(f) ? 0 : f;
    }
    if (t === "int") {
      const v = parseInt(el.value.replace(/\D/g, ""), 10);
      return isNaN(v) ? 0 : v;
    }
    if (t === "check") return el.checked;
    if (t === "bool") return el.value === "true";
    if (t === "code") {
      const m = /^\s*(\d{6})/.exec(el.value);
      return m ? m[1] : el.value.trim();
    }
    return el.value;
  }

  function onValue(el) {
    const p = el.dataset.p,
      v = readValue(el);
    UI.set(p, v);
    if (el.dataset.t === "money" || el.dataset.t === "smoney") {
      const kr = document.querySelector(`[data-kr="${p}"]`);
      if (kr) kr.textContent = v ? U.korWon(v) : "";
    }
    if (el.dataset.t === "code") {
      const i = p.split(".")[2];
      const info = document.querySelector(`[data-codeinfo="${i}"]`);
      if (info) info.textContent = V.income.codeInfo(v);
      if (V.income.rateOf(v) && el.value !== v) el.value = v;
    }
    if (el.dataset.rerender) renderForm(tabOf(p));
    else renderSheet(tabOf(p));
  }

  document.addEventListener("input", (e) => {
    const el = e.target.closest("[data-p]");
    if (el && el.tagName !== "SELECT" && el.type !== "checkbox") onValue(el);
  });
  document.addEventListener("change", (e) => {
    const el = e.target.closest("[data-p]");
    if (el && (el.tagName === "SELECT" || el.type === "checkbox")) onValue(el);
  });
  document.addEventListener("click", (e) => {
    // Element의 closest() 메서드는 주어진 CSS 선택자와 일치하는 요소를 찾을 때까지,
    // 자기 자신을 포함해 위쪽(부모 방향, 문서 루트까지)으로 문서 트리를 순회합니다.
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    if (act === "add" || act === "del") {
      const list = UI.get(b.dataset.list),
        tab = tabOf(b.dataset.list);
      if (act === "add") {
        list.push(V[tab].newItem(list.length + 1, b.dataset.list));
      } else list.splice(+b.dataset.i, 1);
      renderForm(tab);

      // 새로 추가된 항목의 첫 입력칸에 포커스
      // (항목이 여러 칸이면 첫 칸에 포커스, 항목이 하나뿐이면 그 칸에 포커스)
      if (act === "add") {
        document
          .querySelector(`[data-p^="${b.dataset.list}.${list.length - 1}."]`)
          ?.focus();
      }
    } else if (act === "example" || act === "clear") {
      const t = b.dataset.tab;
      TAX.state[t] = act === "example" ? V[t].example() : V[t].blank();
      if (V[t].resetPick) V[t].resetPick();
      renderForm(t);
    } else if (act === "auto") {
      UI.set(b.dataset.p, null); // 직접 수정값을 지우고 자동 계산값으로
      renderSheet(tabOf(b.dataset.p));
    } else if (act === "pick") {
      V.inheritance.setPick(+b.dataset.i);
      renderSheet("inheritance");
    }
  });
  $("#bar-go").addEventListener("click", () => {
    const el = document.getElementById("sheet-" + current);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  /* 시작 */
  $("#bizcodes").innerHTML = TAX.BIZ_RATES.map(
    (r) => `<option value="${r[0]} ${U.esc(r[1])}"></option>`,
  ).join("");
  ORDER.forEach(renderForm);
  const route = () => show((location.hash || "#income").slice(1));
  window.addEventListener("hashchange", route);
  route();
})((globalThis.TAX = globalThis.TAX || {}));
