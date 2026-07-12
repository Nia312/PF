// /api/price.js
// 사용법: /api/price?market=KR|US&ticker=005930 또는 AAPL
// - US: Finnhub에서 실시간에 가까운 시세(약 20분 지연)를 가져와요.
// - KR: 공공데이터포털(금융위원회_주식시세정보)에서 가져오는데,
//       이 데이터는 실시간이 아니라 "전일 종가" 기준이에요. (무료 공식 API의 한계예요)

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
      let krwRate = 1400; // 조회 실패 시 대략적인 기본값
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
      const dataKey = process.env.DATA_GO_KR_KEY;
      if (!dataKey) {
        return res.status(500).json({ error: 'DATA_GO_KR_KEY 환경변수가 설정되지 않았어요' });
      }

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

      if (list.length === 0) {
        return res.status(404).json({ error: '해당 종목코드의 가격을 찾을 수 없어요' });
      }

      list.sort((a, b) => String(b.basDt).localeCompare(String(a.basDt)));
      const latest = list[0];
      const price = parseFloat(latest.clpr);

      return res.status(200).json({
        priceNative: price,
        priceKRW: price
      });
    }

    return res.status(400).json({ error: '지원하지 않는 시장이에요 (KR 또는 US만 가능)' });
  } catch (e) {
    return res.status(500).json({ error: '서버 오류: ' + e.message });
  }
};
