// EDC Orlando 2026 official set times as served by get_lineup_set_times on Oct 30
// (artist_festival_appearances). Festival-local (America/New_York, EST = UTC-5).
// Used by capture.spec.js to stub the RPC.
const RAW = `
fri 13:00 Kinetic Field|Zack Martino
fri 13:00 Neon Garden|Matthias
fri 13:00 Stereobloom|RAJE
fri 13:00 Circuit Grounds|Sloth
fri 14:15 Stereobloom|AAT
fri 14:15 Circuit Grounds|Benda
fri 14:15 Circuit Grounds|Vastive
fri 14:25 Kinetic Field|JOA
fri 15:00 Neon Garden|Inbal
fri 15:25 Kinetic Field|HAYLA
fri 15:30 Circuit Grounds|Big Florida
fri 16:00 Neon Garden|Josh Baker
fri 16:15 Kinetic Field|Pegassi
fri 16:25 Neon Garden|Azzecca
fri 16:30 Circuit Grounds|Kompany
fri 16:45 Stereobloom|Bullet Tooth
fri 16:45 Stereobloom|Sidney Charles
fri 16:47 Kinetic Field|KREAM
fri 17:18 Kinetic Field|Alesso
fri 17:20 Stereobloom|MALUGI
fri 17:30 Circuit Grounds|Adventure Club
fri 17:39 Stereobloom|IDEMI
fri 18:32 Circuit Grounds|Bou
fri 18:32 Circuit Grounds|Kanine
fri 19:30 Neon Garden|Omar+
fri 19:30 Circuit Grounds|Level Up
fri 20:00 Kinetic Field|Afrojack
fri 20:00 Stereobloom|Interplanetary Criminal
fri 20:30 Stereobloom|Joshwa
fri 20:30 Circuit Grounds|Whethan
fri 21:00 Neon Garden|Brunello
fri 21:13 Kinetic Field|Mau P
fri 21:15 Stereobloom|MPH
fri 21:35 Circuit Grounds|Levity
fri 22:30 Stereobloom|Chris Lorenzo
fri 22:31 Kinetic Field|David Guetta
fri 22:45 Circuit Grounds|Wooli
sat 13:00 Casa Bacardí|ALLNIGHTKEV
sat 13:00 Circuit Grounds|ALLEYCVT
sat 13:00 Circuit Grounds|Dknow
sat 13:00 Circuit Grounds|Fury
sat 13:00 Neon Garden|Mai Iachetti
sat 13:00 Kinetic Field|Monoky
sat 13:33 Kinetic Field|Me n ü
sat 14:30 Neon Garden|KinAhau
sat 14:30 Stereobloom|Gabss
sat 14:33 Kinetic Field|Twinsick
sat 15:30 Circuit Grounds|Subsonic
sat 15:30 Stereobloom|Greg 99
sat 15:30 Circuit Grounds|Ray Volpe
sat 15:33 Kinetic Field|Aaron Hibell
sat 16:00 Neon Garden|Miguelle & Tons
sat 16:30 Stereobloom|Alves
sat 16:30 Stereobloom|Fallon
sat 16:30 Circuit Grounds|AVELLO
sat 16:33 Kinetic Field|ACRAZE
sat 16:33 Kinetic Field|CID
sat 17:30 Circuit Grounds|Jkyl & Hyde
sat 17:30 Stereobloom|Devault
sat 17:38 Kinetic Field|Alan Walker
sat 18:30 Circuit Grounds|LAYZ
sat 18:45 Stereobloom|Discip
sat 19:00 Neon Garden|Rossi.
sat 20:00 Stereobloom|Roddy Lima
sat 20:05 Kinetic Field|Steve Aoki
sat 20:30 Neon Garden|Dennis Cruz
sat 21:13 Kinetic Field|Disco Lines
sat 21:15 Stereobloom|AYYBO
sat 21:35 Circuit Grounds|Skull Machine
sat 22:00 Neon Garden|Franky Rizardo
sat 22:30 Stereobloom|ChaseWest
sat 22:31 Kinetic Field|Kaskade
sat 22:45 Circuit Grounds|Alison Wonderland
sun 13:00 Neon Garden|Ultrathem
sun 13:00 Kinetic Field|ESSE
sun 13:00 Stereobloom|M81!
sun 13:00 Circuit Grounds|Discovery Project
sun 13:15 Stereobloom|Know Good
sun 14:10 Stereobloom|Chef Boyarbeatz
sun 14:10 Stereobloom|CØNTRA
sun 14:25 Circuit Grounds|A Little Sound
sun 14:25 Circuit Grounds|Kaivon
sun 14:35 Kinetic Field|AR/CO
sun 16:10 Stereobloom|Phrva
sun 16:30 Neon Garden|Adrián Mills
sun 16:35 Circuit Grounds|San Holo
sun 16:45 Kinetic Field|Ian Asher
sun 17:10 Stereobloom|SIPPY
sun 17:25 Circuit Grounds|Of The Trees
sun 17:35 Kinetic Field|SLANDER
sun 17:54 Kinetic Field|I Hate Models
sun 18:00 Neon Garden|Marlon Hoffstadt
sun 18:40 Circuit Grounds|Meduza
sun 19:20 Stereobloom|Taiki Nulight
sun 19:30 Neon Garden|Brutalismus 3000
sun 19:30 Neon Garden|Boys Noize
sun 19:45 Circuit Grounds|Maddix
sun 20:00 Neon Garden|SHDW
sun 20:02 Kinetic Field|Alok
sun 20:30 Stereobloom|Ravenscoon
sun 20:35 Kinetic Field|Jessica Audiffred
sun 20:45 Circuit Grounds|DJ Diesel
sun 20:45 Circuit Grounds|Deorro
sun 21:00 Neon Garden|KI/KI
sun 21:15 Kinetic Field|Hardwell
sun 21:40 Circuit Grounds|ATLiens
sun 21:50 Stereobloom|Boogie T
sun 22:28 Kinetic Field|Martin Garrix
sun 22:30 Neon Garden|Klangkuenstler
sun 22:50 Stereobloom|TroyBoi
sun 22:55 Circuit Grounds|Holy Priest
`;
const DAY = { fri: 6, sat: 7, sun: 8 };
const SETS = RAW.trim().split('\n').map(line => {
  const [, d, hh, mm, stage, name] = /^(\w+) (\d+):(\d+) ([^|]+)\|(.+)$/.exec(line);
  const start_at = new Date(Date.UTC(2026, 10, DAY[d], +hh + 5, +mm)).toISOString();
  return { name, start_at, end_at: null, stage };
});
module.exports = { ok: true, tz: 'America/New_York', date: '2026-11-06', days: 3, sets: SETS };
