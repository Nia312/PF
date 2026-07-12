// /api/daily-brief.js
// 국장(코스피/코스닥) + 미장(S&P500/나스닥/다우 ETF 프록시) 지수와
// 네이버 뉴스 검색 결과를 모아서 반환해요.
// 국내 지수는 전일 기준(공공데이터포털 한계), 해외는 Finnhub 실시간에 가까운 값이에요.

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const indices = [];

  // ---------- 국내 지수 (코스피/코스닥) ----------
  const dataKey = process.env.DATA_GO_KR_KEY;
  if (dataKey) {
    const today = new Date();
    const begin = new Date(today);
    begin.setDate(begin.getDate() - 10);
    const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

    for (const idxNm of ['코스피', '코스닥']) {
      try {
        const url =
          `https://apis.data.go.kr/1160100/service/GetMarketIndexInfoService/getStockMarketIndex` +
          `?serviceKey=${dataKey}&numOfRows=10&resultType=json` +
          `&idxNm=${encodeURIComponent(idxNm)}` +
          `&beginBasDt=${fmt(begin)}&endBasDt=${fmt(today)}`;
        const r = await fetch(url);
        const d = await r.json();
        const items = d && d.response && d.response.body && d.response.body.items
          ? d.response.body.items.item
          : null;
        const list = Array.isArray(items) ? items : (items ? [items] : []);
        if (list.length > 0) {
          list.sort((a, b) => String(b.basDt).localeCompare(String(a.basDt)));
          const latest = list[0];
          indices.push({
            name: idxNm,
            value: parseFloat(latest.clpr),
            changePct: parseFloat(latest.fltRt)
          });
        }
      } catch (e) { /* 이 지수만 건너뛰기 */ }
    }
  }

  // ---------- 해외 지수 (ETF 프록시로 근사) ----------
  const finnhubKey = process.env.FINNHUB_API_KEY;
  if (finnhubKey) {
    const usProxies = [
      { name: 'S&P500 (SPY)', symbol: 'SPY' },
      { name: '나스닥 (QQQ)', symbol: 'QQQ' },
      { name: '다우존스 (DIA)', symbol: 'DIA' }
    ];
    for (const p of usProxies) {
      try {
        const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${p.symbol}&token=${finnhubKey}`);
        const q = await r.json();
        if (q && q.c) {
          indices.push({ name: p.name, value: q.c, changePct: q.dp });
        }
      } catch (e) { /* 이 지수만 건너뛰기 */ }
    }
  }

  // ---------- 뉴스 (네이버 뉴스 검색) ----------
  let articles = [];
  const naverId = process.env.NAVER_CLIENT_ID;
  const naverSecret = process.env.NAVER_CLIENT_SECRET;
  if (naverId && naverSecret) {
    try {
      const stripTags = (s) => (s || '')
        .replace(/<[^>]*>/g, '')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&#39;/g, "'");

      const r = await fetch(
        'https://openapi.naver.com/v1/search/news.json?query=' + encodeURIComponent('증시') + '&display=6&sort=date',
        {
          headers: {
            'X-Naver-Client-Id': naverId,
            'X-Naver-Client-Secret': naverSecret
          }
        }
      );
      const d = await r.json();
      articles = (d.items || []).map((item) => ({
        title: stripTags(item.title),
        summary: stripTags(item.description),
        source: '네이버뉴스',
        time: item.pubDate
          ? new Date(item.pubDate).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          : ''
      }));
    } catch (e) { /* 뉴스 조회 실패 시 빈 배열 유지 */ }
  }

  return res.status(200).json({ indices, articles });
};
