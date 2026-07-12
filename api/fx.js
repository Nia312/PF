// /api/fx.js
// USD -> KRW 환율을 조회해요. (open.er-api.com, 키 필요 없음, 하루 1회 갱신되는 값이에요)

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD');
    const d = await r.json();

    if (!d || d.result !== 'success' || !d.rates || !d.rates.KRW) {
      return res.status(502).json({ error: '환율 정보를 가져오지 못했어요' });
    }

    return res.status(200).json({
      rate: d.rates.KRW,
      asOf: d.time_last_update_utc || null
    });
  } catch (e) {
    return res.status(500).json({ error: '서버 오류: ' + e.message });
  }
};
