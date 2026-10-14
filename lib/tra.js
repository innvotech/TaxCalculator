// Calls the TRA UMVVS calculator API (https://taxpayerportal.tra.go.tz/#/umvvs/calculator)
// and walks it from a chassis initial + year to the vehicle duty details.

const BASE = process.env.TRA_API_BASE ||
  'https://taxpayerportal.tra.go.tz/umvvs-api/ExternalCalculator';

// Searched first so common Japanese imports resolve with few calls.
const PRIORITY_MAKES = ['TOYOTA', 'NISSAN', 'HONDA', 'MITSUBISHI', 'MAZDA', 'SUBARU',
  'SUZUKI', 'ISUZU', 'DAIHATSU', 'LEXUS'];

// In-memory cache, kept while the serverless instance stays warm.
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const cache = new Map();

class DutyError extends Error {
  constructor(message, extra = {}) { super(message); Object.assign(this, extra); }
}

async function api(endpoint, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.append(k, String(v));
  const url = `${BASE}/${endpoint}${qs.toString() ? '?' + qs.toString().replace(/\+/g, '%20') : ''}`;
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (tra-duty-app)' },
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      last = e;
      await new Promise(res => setTimeout(res, 500 + attempt * 1000));
    }
  }
  throw new DutyError(`Could not reach TRA (${endpoint}): ${last && last.message}`, { status: 502 });
}

async function cached(key, fetcher) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = await fetcher();
  cache.set(key, { at: Date.now(), value });
  return value;
}

const getMakes = () => cached('makes', () => api('getMakes'));
const getModelBodies = makeId => cached(`models:${makeId}`,
  async () => (await api('getModelBody', { makeId })).map(m => m.modelBody));

// modelBody looks like "HARRIER - ACU30 - SUV"; the chassis code is the middle part.
function chassisMatches(modelBody, chassis, exact) {
  const parts = modelBody.split(' - ').map(p => p.trim().toUpperCase());
  const codes = parts.length >= 3 ? parts.slice(1, -1) : parts.slice(1);
  return codes.some(code => [code, ...code.split(/[\s/,]+/)]
    .some(t => (exact ? t === chassis : t.startsWith(chassis))));
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const n = i++; out[n] = await fn(items[n]); }
  }));
  return out;
}

async function findModels(chassis, makeFilter) {
  let makes = [...await getMakes()];
  if (makeFilter) {
    makes = makes.filter(m => m.makeName.toUpperCase() === makeFilter.toUpperCase());
    if (!makes.length) throw new DutyError(`Unknown make "${makeFilter}".`, { status: 404 });
  }
  const rank = n => { const i = PRIORITY_MAKES.indexOf(n.toUpperCase()); return i < 0 ? 99 : i; };
  makes.sort((a, b) => rank(a.makeName) - rank(b.makeName));
  const head = makes.slice(0, PRIORITY_MAKES.length);
  const tail = makes.slice(PRIORITY_MAKES.length);

  const scan = async (subset, exact) => {
    const lists = await mapLimit(subset, 8, m => getModelBodies(m.makeId));
    const found = [];
    subset.forEach((m, idx) => lists[idx].forEach(body => {
      if (chassisMatches(body, chassis, exact)) found.push({ make: m.makeName, makeId: m.makeId, modelBody: body });
    }));
    return found;
  };
  for (const exact of [true, false]) {
    let found = await scan(head, exact);
    if (!found.length && tail.length) found = await scan(tail, exact);
    if (found.length) return found;
  }
  return [];
}

// Returns the single option, the one the user picked, or null (meaning: ask).
function pick(label, options, chosen) {
  if (!options.length) throw new DutyError(`TRA returned no ${label} options.`, { status: 404 });
  if (chosen) {
    const hit = options.find(o => o.toUpperCase() === String(chosen).toUpperCase());
    if (!hit) throw new DutyError(`"${chosen}" is not a valid ${label}.`, { status: 400 });
    return hit;
  }
  return options.length === 1 ? options[0] : null;
}

/**
 * Walks the TRA calculator. Returns either
 *   { status: 'ok', details }
 *   { status: 'choose', step, label, options: [{ value, label }] }
 */
async function getDuty({ chassis, year, make, model, country, fuel, engine }) {
  chassis = String(chassis || '').trim().toUpperCase();
  year = parseInt(year, 10);
  if (!chassis) throw new DutyError('Enter a chassis initial, e.g. ACU30.', { status: 400 });
  if (!year) throw new DutyError('Enter a year of manufacture, e.g. 2012.', { status: 400 });

  const matches = await findModels(chassis, make);
  if (!matches.length) {
    throw new DutyError(`No vehicle with chassis "${chassis}" was found in TRA's list.`, { status: 404 });
  }

  // Keep the models that list the requested year.
  const years = await mapLimit(matches, 6, async m =>
    (await api('getYom', { makeId: m.makeId, modelBody: m.modelBody })).map(y => parseInt(y.yom, 10)));
  const withYear = matches.filter((m, i) => years[i].includes(year));
  if (!withYear.length) {
    const available = matches.map((m, i) => ({
      model: `${m.make} ${m.modelBody}`, years: [...years[i]].sort((a, b) => a - b),
    }));
    throw new DutyError(`Year ${year} is not listed for chassis ${chassis}.`, { status: 404, available });
  }

  const modelKey = m => `${m.makeId}|${m.modelBody}`;
  const modelValue = pick('model', withYear.map(modelKey), model);
  if (!modelValue) {
    return { status: 'choose', step: 'model', label: 'Model and Body',
      options: withYear.map(m => ({ value: modelKey(m), label: `${m.make} ${m.modelBody}` })) };
  }
  const chosenModel = withYear.find(m => modelKey(m) === modelValue);
  const q = { makeId: chosenModel.makeId, modelBody: chosenModel.modelBody, yom: year };

  const steps = [
    ['country', 'Country of Origin', 'getCountryOfOrigin', 'countryOfOrigin', country],
    ['fuel', 'Energy Type', 'getFuelType', 'fuelType', fuel],
    ['engine', 'Engine Capacity', 'getEngineCapacity', 'engineCapacity', engine],
  ];
  for (const [step, label, endpoint, field, chosen] of steps) {
    const options = (await api(endpoint, q)).map(o => o[field]);
    const value = pick(label.toLowerCase(), options, chosen);
    if (!value) return { status: 'choose', step, label, options: options.map(o => ({ value: o, label: o })) };
    q[field] = value;
  }

  let details = await api('getVehicleDetails', {
    makeId: q.makeId, modelBody: q.modelBody, yom: year,
    cuntryOfOrigin: q.countryOfOrigin, // TRA's own spelling of this parameter
    countryOfOrigin: q.countryOfOrigin,
    fuelType: q.fuelType, engineCapacity: q.engineCapacity,
  });
  if (Array.isArray(details)) details = details[0];
  if (!details) throw new DutyError('TRA returned no vehicle details.', { status: 404 });
  return { status: 'ok', details };
}

module.exports = { getDuty, DutyError, chassisMatches };
