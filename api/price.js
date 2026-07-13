// /api/price.js
// 사용법: /api/price?market=KR|US&ticker=005930 또는 AAPL
// - US: Finnhub에서 실시간에 가까운 시세(약 20분 지연)를 가져와요.
// - KR: 1차로 네이버 증권(비공식)에서 당일 종가를 가져오고,
//       실패하면 공공데이터포털(금융위원회_주식시세정보, 전일 종가 기준)로 자동 폴백해요.

const NAVER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Referer': 'https://m.stock.naver.com/'
};

function parseNumber(v){
  if (v == null) return null;
  const n = typeof v === 'string' ? parseFloat(v.replace(/,/g, '')) : v;
  return isNaN(n) ? null : n;
}

async function fetchKrPriceFromNaver(ticker){
  const r = await fetch(`https://m.stock.naver.com/api/stock/${encodeURIComponent(ticker)}/basic`, {
    headers: NAVER_HEADERS
  });
  if (!r.ok) return null;
  const data = await r.json();
  const price = parseNumber(data && data.closePrice);
  return price;
}

async function fetchKrPriceFromDataGoKr(ticker, dataKey){
  const today = new Date();
  const begin = new Date(today);
  begin.setDate(begin.getDate() - 10);
  const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

  const url =
    `https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo` +
    `?serviceKey=${dataKey}&numOfRows=10&pageNo=1&resultType=json` +
    `&likeSrtnCd=${encodeURIComponent(ticker)}` +
    `&beginBasDt=${fmt(begin)}&endBasDt=${fmt(today)}`;

  const krRes = await fetch(url);
  const krData = await krRes.json();
  const items = krData && krData.response && krData.response.body && krData.response.body.items
    ? krData.response.body.items.item
    : null;
  const list = Array.isArray(items) ? items : (items ? [items] : []);
  if (list.length === 0) return null;

  list.sort((a, b) => String(b.basDt).localeCompare(String(a.basDt)));
  return parseNumber(list[0].clpr);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { market, ticker } = req.query;
  if (!market || !ticker) {
    return res.status(400).json({ error: 'market과 ticker 파라미터가 필요해요' });
  }

  try {
    if (market === 'US') {
      const finnhubKey = process.env.FINNHUB_API_KEY;
      if (!finnhubKey) {
        return res.status(500).json({ error: 'FINNHUB_API_KEY 환경변수가 설정되지 않았어요' });
      }

      const quoteRes = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${finnhubKey}`
      );
      const quote = await quoteRes.json();

      if (quote.c == null || quote.c === 0) {
        return res.status(404).json({
          error: '해당 티커의 가격을 찾을 수 없어요',
          debug_finnhub_response: quote
        });
      }

      // 원화 환산을 위한 환율 조회 (키 필요 없는 무료 API)
      let krwRate = 1500; // 조회 실패 시 대략적인 기본값
      try {
        const fxRes = await fetch('https://open.er-api.com/v6/latest/USD');
        const fx = await fxRes.json();
        if (fx && fx.rates && fx.rates.KRW) krwRate = fx.rates.KRW;
      } catch (e) { /* 환율 조회 실패 시 기본값 사용 */ }

      return res.status(200).json({
        priceNative: quote.c,
        priceKRW: quote.c * krwRate
      });
    }

    if (market === 'KR') {
      // 1차: 네이버 증권 (당일 종가)
      try {
        const naverPrice = await fetchKrPriceFromNaver(ticker);
        if (naverPrice != null) {
          return res.status(200).json({ priceNative: naverPrice, priceKRW: naverPrice, source: 'naver' });
        }
      } catch (e) { /* 네이버 실패 시 아래 공공데이터로 폴백 */ }

      // 2차 폴백: 공공데이터포털 (네이버가 막히면 여기로, 전일 종가 기준)
      const dataKey = process.env.DATA_GO_KR_KEY;
      if (!dataKey) {
        return res.status(404).json({ error: '네이버 조회에 실패했고, 공공데이터포털 키(DATA_GO_KR_KEY)도 설정되어 있지 않아요' });
      }
      try {
        const fallbackPrice = await fetchKrPriceFromDataGoKr(ticker, dataKey);
        if (fallbackPrice != null) {
          return res.status(200).json({ priceNative: fallbackPrice, priceKRW: fallbackPrice, source: 'data.go.kr' });
        }
        return res.status(404).json({ error: '해당 종목코드의 가격을 찾을 수 없어요 (네이버, 공공데이터 둘 다 실패)' });
      } catch (e) {
        return res.status(500).json({ error: '공공데이터포털 조회 중 오류: ' + e.message });
      }
    }

    return res.status(400).json({ error: '지원하지 않는 시장이에요 (KR 또는 US만 가능)' });
  } catch (e) {
    return res.status(500).json({ error: '서버 오류: ' + e.message });
  }
};
