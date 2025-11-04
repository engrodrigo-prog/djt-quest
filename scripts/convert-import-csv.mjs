import fs from 'fs';
import path from 'path';

const sourcePath = path.resolve('src', 'assets', 'cadastro Cpfl go.csv');
const targetPath = path.resolve('src', 'assets', 'cadastro_cpfl_go_import.csv');

if (!fs.existsSync(sourcePath)) {
  throw new Error(`Arquivo fonte não encontrado: ${sourcePath}`);
}

const text = fs.readFileSync(sourcePath, 'utf-8');
const cleanText = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
const lines = cleanText.split(/\r?\n/).filter(line => line.trim().length > 0);
if (lines.length < 2) {
  throw new Error('CSV sem dados suficientes.');
}
const delimiter = (lines[0].match(/;/g)?.length || 0) > (lines[0].match(/,/g)?.length || 0) ? ';' : ',';

const parseLine = (line) => {
  const out = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === delimiter && !inQuotes) {
      out.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  out.push(current.trim());
  return out;
};

const cargoMap = (cargo) => {
  const normalized = cargo.trim().toLowerCase();
  if (normalized.startsWith('gerente')) return 'Gerente II';
  if (normalized.startsWith('coordenador') || normalized.startsWith('coordenadores')) return 'Coordenação';
  return cargo;
};

const parseDateBR = (s) => {
  const m = /^([0-3]?\d)\/([01]?\d)\/(\d{4})$/.exec((s || '').trim());
  if (!m) return '';
  const [_, d, mo, y] = m;
  const dd = d.padStart(2, '0');
  const mm = mo.padStart(2, '0');
  return `${y}-${mm}-${dd}`;
};

const rows = [];
for (let i = 1; i < lines.length; i++) {
  const cols = parseLine(lines[i]);
  if (cols.length < 5) continue;
  const area = cols[0]?.trim();
  const matricula = cols[1]?.trim();
  const email = cols[2]?.trim();
  const nome = cols[3]?.trim();
  const cargoOriginal = cols[4]?.trim();
  const dataNascimento = cols[5] ? parseDateBR(cols[5]) : '';
  if (!email || !nome) continue;
  rows.push({
    nome,
    matricula,
    email: email.toLowerCase(),
    cargo: cargoMap(cargoOriginal || ''),
    sigla_area: area,
    base_operacional: area,
    date_of_birth: dataNascimento,
  });
}

const header = 'nome,matricula,email,cargo,sigla_area,base_operacional,date_of_birth';
const csvBody = rows.map((r) => (
  [r.nome, r.matricula, r.email, r.cargo, r.sigla_area, r.base_operacional, r.date_of_birth]
    .map((value = '') => value.includes(',') ? `"${value}"` : value)
    .join(',')
));
const output = [header, ...csvBody].join('\n');
fs.writeFileSync(targetPath, output, 'utf-8');
console.log(`Gerado ${rows.length} registros em ${targetPath}`);
