/* 공통 유틸: 숫자·날짜·세율표 계산 */
(function (TAX) {
  const U = TAX.util = {};

  /* 숫자 */
  U.fl = v => Math.floor(v + 1e-7);              // 원 미만 절사 (부동소수 오차 보정)
  U.pos = v => (v > 0 ? v : 0);
  U.n = v => (typeof v === 'number' && isFinite(v) ? v : 0);
  U.sum = (obj, keys) => keys.reduce((s, k) => s + U.n(obj[k]), 0);

  /* 구간 표 */
  U.bracket = (x, table) => { for (const b of table) if (x <= b[0]) return b; return table[table.length - 1]; };
  // 누진세: 금액 × (세율 + 가산세율) − 누진공제
  U.progressive = (x, table, add = 0) => {
    if (!(x > 0)) return 0;
    const b = U.bracket(x, table);
    return U.fl(x * (b[1] + add) - b[2]);
  };
  U.rateOf = (x, table, add = 0) => U.bracket(x > 0 ? x : 0, table)[1] + add;
  // 공제 표: 금액 × 비율 + 가산액
  U.piecewise = (x, table) => {
    if (!(x > 0)) return 0;
    const b = U.bracket(x, table);
    return x * b[1] + b[2];
  };

  /* 날짜 (yyyy-mm-dd 문자열) */
  U.parseDate = s => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const t = new Date(Date.UTC(y, mo - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
    return { y, m: mo, d };
  };
  U.isDate = s => !!U.parseDate(s);
  U.toUTC = s => { const p = U.parseDate(s); return p ? Date.UTC(p.y, p.m - 1, p.d) : null; };
  U.iso = t => new Date(t).toISOString().slice(0, 10);
  U.today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  // 만 연수 (엑셀 DATEDIF(a, b, "y"))
  U.datedifY = (a, b) => {
    const A = U.parseDate(a), B = U.parseDate(b);
    if (!A || !B) return 0;
    let y = B.y - A.y;
    if (B.m < A.m || (B.m === A.m && B.d < A.d)) y--;
    return y < 0 ? 0 : y;
  };
  // 해당 월 말일부터 k개월 뒤 말일 (엑셀 DATE(Y, M+k+1, 0))
  U.monthEnd = (s, k) => { const p = U.parseDate(s); return p ? U.iso(Date.UTC(p.y, p.m + k, 0)) : null; };
  U.yearOf = s => (U.parseDate(s) || {}).y || 0;

  // 숫자 8자리 → yyyy-mm-dd (입력 중에는 yyyy, yyyy-mm 처럼 단계별로)
  U.formatDateDigits = raw => {
    const d = String(raw || '').replace(/\D/g, '').slice(0, 8);
    if (d.length <= 4) return d;
    if (d.length <= 6) return `${d.slice(0, 4)}-${d.slice(4)}`;
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
  };

  // 납부지연가산세: 신고기한 다음 날부터 납부일까지, 기간별 이율 적용
  U.lateInterest = (tax, deadline, pay) => {
    const s = U.toUTC(deadline), e = U.toUTC(pay);
    if (s == null || e == null || e <= s || !(tax > 0)) return { amount: 0, days: 0 };
    let amt = 0, days = 0;
    for (const [from, to, rate] of TAX.tables.LATE_INTEREST) {
      const a = from ? U.toUTC(from) : -Infinity, b = to ? U.toUTC(to) : Infinity;
      const lo = Math.max(s, a), hi = Math.min(e, b);
      if (hi > lo) { const dd = Math.round((hi - lo) / 86400000); days += dd; amt += tax * dd * rate; }
    }
    return { amount: U.fl(amt), days };
  };

  /* 화면 표시 */
  U.won = v => { const r = Math.round(v) || 0; return (r < 0 ? '−' : '') + Math.abs(r).toLocaleString('ko-KR'); };
  U.korWon = v => {
    v = Math.round(v || 0);
    if (v === 0) return '0원';
    const neg = v < 0; v = Math.abs(v);
    const jo = Math.floor(v / 1e12), eok = Math.floor((v % 1e12) / 1e8), man = Math.floor((v % 1e8) / 1e4), rest = v % 1e4;
    const parts = [];
    if (jo) parts.push(jo.toLocaleString('ko-KR') + '조');
    if (eok) parts.push(eok.toLocaleString('ko-KR') + '억');
    if (man) parts.push(man.toLocaleString('ko-KR') + '만');
    if (rest) parts.push(rest.toLocaleString('ko-KR'));
    return (neg ? '−' : '') + parts.join(' ') + '원';
  };
  U.pct = v => (Math.round(v * 10000) / 100) + '%';
  U.esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  U.fmtDate = s => { const p = U.parseDate(s); return p ? `${p.y}년 ${p.m}월 ${p.d}일` : ''; };
  U.clone = o => JSON.parse(JSON.stringify(o));
})(globalThis.TAX = globalThis.TAX || {});
