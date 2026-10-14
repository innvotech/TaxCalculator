// GET /api/duty?chassis=ACU30&year=2012[&model=..&country=..&fuel=..&engine=..&make=..]
const { getDuty, DutyError } = require('../lib/tra');

module.exports = async (req, res) => {
  const p = req.query || {};
  try {
    const result = await getDuty({
      chassis: p.chassis, year: p.year, make: p.make, model: p.model,
      country: p.country, fuel: p.fuel, engine: p.engine,
    });
    if (result.status === 'ok') res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json(result);
  } catch (e) {
    const status = e instanceof DutyError ? e.status || 400 : 500;
    res.status(status).json({ status: 'error', message: e.message, available: e.available });
  }
};
