const $ = id => document.getElementById(id);
const form = $('form'), choicesEl = $('choices'), msg = $('msg'), go = $('go');
// Choices made so far for the current chassis/year (model, country, fuel, engine).
let picks = {};

const VEHICLE_ROWS = [
  ['Reference Number', 'referenceNumber'], ['Make', 'make'], ['Model & Model Number', 'model'],
  ['Body Type', 'bodyType'], ['Year of Manufacture', 'yom'], ['Energy Type', 'fuelType'],
  ['Engine Capacity', 'engineCapacity'], ['Country of Origin', 'country'],
  ['Customs Value CIF (USD)', 'cifInUSD'],
];
const TAX_ROWS = [
  ['Import Duty (USD)', 'importDutyInUSD'], ['Excise Duty (USD)', 'exiseDutyInUSD'],
  ['Excise Duty Due to Age (USD)', 'exiseDutyDueToAgeInUSD'],
  ['Customs Processing Fee (USD)', 'customProcessingFeeInUSD'],
  ['Railway Dev Levy (USD)', 'railwayDevLevyInUSD'], ['Industrial Dev Levy (USD)', 'indDevLevy'],
  ['Value Added Tax (USD)', 'vatInUSD'],
];
const TOTAL_ROWS = [
  ['Total Import Taxes (USD):', 'totalImportTaxesInUSD'], ['Total Import Taxes (TZS):', 'totalImportTaxesInTZS'],
  ['HIV Response Levy (TZS):', 'hivRespLevy'], ['Vehicle Registration Fee (TZS):', 'vehicleRegistrationFeeInTZS'],
];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const rows = (list, d) => list.map(([label, key]) =>
  `<div class="row"><span>${esc(label)}</span><span>${esc(d[key])}</span></div>`).join('');

function showMessage(text, info = false) {
  msg.textContent = text; msg.className = 'msg' + (info ? ' info' : ''); msg.hidden = !text;
}

function showChoice(r) {
  // Ask the user to pick one option for this step, then resubmit.
  const id = `pick-${r.step}`;
  choicesEl.insertAdjacentHTML('beforeend',
    `<label>${esc(r.label)}<select id="${id}" data-step="${esc(r.step)}" required>
       <option value="">Select ${esc(r.label.toLowerCase())}…</option>
       ${r.options.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}
     </select></label><p class="choice-note">TRA lists several options here. Pick one to continue.</p>`);
  const sel = $(id);
  sel.focus();
  sel.addEventListener('change', () => {
    // Changing an earlier pick invalidates the later ones.
    const labels = [...choicesEl.querySelectorAll('label')];
    const idx = labels.indexOf(sel.closest('label'));
    labels.slice(idx + 1).forEach(l => { delete picks[l.querySelector('select').dataset.step]; l.nextElementSibling?.remove(); l.remove(); });
    if (sel.value) { picks[r.step] = sel.value; submit(); }
  });
}

function showDetails(d) {
  $('modal-title').innerHTML = `You are viewing valuation details of a <b>${esc(d.yom)} ${esc(d.make)} ${esc(d.modelBody)}</b>`;
  $('vehicle').innerHTML = rows(VEHICLE_ROWS, d);
  $('taxes').innerHTML = rows(TAX_ROWS, d);
  $('totals').innerHTML = rows(TOTAL_ROWS, d) +
    `<div class="row grand"><span>TOTAL TAXES (TZS):</span><span>${esc(d.totalTaxesInTZS)}</span></div>`;
  $('period').textContent = d.year ? `TRA valuation period ${d.year}, quarter ${d.quarter}` : '';
  $('modal').hidden = false;
  $('close').focus();
}

async function submit() {
  const chassis = $('chassis').value.trim().toUpperCase();
  const year = $('year').value.trim();
  if (!chassis || !year) return;
  const params = new URLSearchParams({ chassis, year, ...picks });
  go.disabled = true; go.textContent = 'Searching TRA…';
  showMessage('Looking up the vehicle on the TRA calculator. The first search can take a few seconds.', true);
  try {
    const r = await fetch(`/api/duty?${params}`).then(x => x.json());
    showMessage('');
    if (r.status === 'ok') showDetails(r.details);
    else if (r.status === 'choose') showChoice(r);
    else {
      let text = r.message || 'Something went wrong.';
      if (r.available) text += '\n\nYears TRA lists:\n' + r.available.map(a => `${a.model}: ${a.years.join(', ')}`).join('\n');
      showMessage(text);
    }
  } catch (e) {
    showMessage('Could not reach the server. Check your connection and try again.');
  } finally {
    go.disabled = false; go.textContent = 'Get Vehicle Details';
  }
}

function resetChoices() { picks = {}; choicesEl.innerHTML = ''; }

form.addEventListener('submit', e => { e.preventDefault(); submit(); });
['chassis', 'year'].forEach(id => $(id).addEventListener('input', () => { resetChoices(); showMessage(''); }));
$('clear').addEventListener('click', () => { form.reset(); resetChoices(); showMessage(''); $('chassis').focus(); });
const close = () => { $('modal').hidden = true; };
$('close').addEventListener('click', close);
$('close2').addEventListener('click', close);
$('print').addEventListener('click', () => window.print());
$('modal').addEventListener('click', e => { if (e.target.id === 'modal') close(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
