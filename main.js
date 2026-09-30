import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ARCHETYPES, pickArchetype, pickLine, gluttonStage, sabotageStep } from './anomaly.js';
import { LINES } from './lines.js';

// Layout (meters, characters are ~1 m tall):
//   lobby      z ∈ [0, 9]   — waiting area with chairs, entrance at z = 9
//   wall z = 0              — sliding doors (x = 0) + wide glass window (x < 0)
//   reception  z ∈ [-7, 0]  — partition at z = -4.5 with the service window at x = 1.5
//   staff room z ∈ [-7, -4.5] — behind the glass: the doctor's desk, coffee machine, a door to the ward corridor at x = 5
//   east wing  x ∈ [5, 10.4] — corridor x ∈ [5, 6.6] (entered from the lobby), wards x ∈ [6.6, 10.4]
//   west wing  x ∈ [-10.4, -5] — its mirror, reaching north past the main building to z = -15:
//              wards 5–6, the X-ray room, the lab, the operating room, and quarantine at the far end
const WALL_H = 2.6;
const DOOR_W = 1.6;
const HATCH_X = 1.5;
const PARTITION_Z = -4.5;
const CORRIDOR_X = 6.6;  // corridor ↔ wards wall
const EAST_X = 10.4;
const WARD_Z = [-5, -1, 3, 7]; // ward centres, each ward is 4 m deep
const WEST_Z = [7, 3, -1, -5, -9, -13]; // west wing room centres, south to north
const WEST_END = -15; // the west wing's north wall
const STAFF_DOOR_Z = -5.75; // centre of the staff door in the east wall, 0.9 m wide
const CHAIR = { x: HATCH_X, z: -6.25, seat: 0.62 }; // the doctor's chair behind the reception desk
const SIT_Y = 0.46; // doctor's root height while sitting (the Sit clip keeps the hips at standing height)

// Every ward has the same tool cabinet. Each patient's illness is cured by its own sequence of tools from it;
// the ward computer shows the sequence once the sample is analysed in the lab.
const TOOLS = {
  feather: '🪶 Пір\'їнка', ointment: '🧴 Мазь від свербежу', plaster: '🩹 Пластир', warmer: '♨️ Грілка',
  syrup: '🥄 Сироп «Антибуль»', bubbles: '🫧 Мильні бульбашки', oil: '🛢️ Олійка', wrench: '🔧 Гайковий ключ',
};
const TOOL_COLORS = [0xf5f5f5, 0x6fb8e8, 0xf2c14e, 0xe8735a, 0x9b59b6, 0x8fe3ff, 0xc8905a, 0x8a97a8];
// A severe case is cured only in the operating room, with the tools from its own cabinet, always in this order:
// [tool, its label, what the doctor does, what happens]. No blood: the scissors just take off a little bump.
const SURGERY = [
  ['anesthesia', '💉 Наркоз', 'дати понюхати наркоз, щоб пацієнт солодко заснув', 'Ммм… пахне полуницею… Хр-р-р…'],
  ['scissors', '✂️ Ножиці', 'обережно зняти бубочку', 'Чик! Бубочку знято. Пацієнт усміхається уві сні.'],
  ['thread', '🧵 Нитка з голкою', 'зашити акуратним швом', 'Шов рівненький, як вишиванка.'],
];
const TOOL_NAMES = { ...TOOLS, ...Object.fromEntries(SURGERY.map(([k, label]) => [k, label])) };
const surgeryOrder = SURGERY.map(([, label]) => label).join(' → ');

// walkSpeed: metres per second at animation timeScale 1 (Pink Critter's value is from its README;
// the others are estimates until their pipelines report one).
const CHARACTERS = [
  { id: 'pink_critter', name: 'Рожевий Бешкетник', url: './assets/models/characters/01_pink_critter/pink_critter.glb',
    walk: 'Walk', idle: 'Idle', happy: 'Idle_Smug', walkSpeed: 0.217,
    hello: 'О, лікарю! Я тут просто… на розвідку. Не зважайте.',
    complaint: 'Та нічого не болить! Хіба що ріжок свербить, коли я кудись крадусь.',
    inBed: 'Лежати — це нудно. Коли вже можна тікати?',
    // steps: [tool, what the doctor does, how the patient reacts]
    illness: { name: 'Ріжкова сверблячка', steps: [
      ['feather', 'полоскотати ріжок, щоб знайти, де свербить', 'Хі-хі-хі! Ось тут, біля самого кінчика!'],
      ['ointment', 'намазати ріжок маззю', 'Ох, холодненька… Вже майже не свербить.'],
      ['plaster', 'заклеїти ріжок пластирем', 'Тепер можна крастися і не чухатись!']] } },
  { id: 'spott', name: 'Спотт', url: './assets/models/characters/02_spott/spott.glb',
    walk: 'Walk_Waddle', idle: 'Idle', happy: 'Joy_Bounce', walkSpeed: 0.25,
    hello: 'Привіііт! А у вас тут дають льодяники?',
    complaint: 'Я з\'їв три торти, і тепер животик робить «буль-буль».',
    inBed: 'Тут така м\'яка подушка! А на обід буде желе?',
    illness: { name: 'Тортовий бурчунит', steps: [
      ['warmer', 'покласти грілку на животик', 'Ммм, тепло… «Буль-буль» стало тихіше.'],
      ['syrup', 'дати ложку сиропу «Антибуль»', 'Смачно! А можна ще ложечку? …Ой, вже не бурчить!']] } },
  { id: 'ploof', name: 'Плуф', url: './assets/models/characters/03_ploof/ploof.glb',
    walk: 'Walk_Soft', idle: 'Idle', happy: 'Happy_Sway', walkSpeed: 0.25,
    hello: 'Добрий день… Ви сьогодні трохи втомлений, так?',
    complaint: 'Мені сумно, коли сумно іншим. А зараз сумно всім у черзі.',
    inBed: 'Дякую, що зайшли. Тут тихо і спокійно.',
    illness: { name: 'Співчутлива хмурість', steps: [
      ['bubbles', 'пустити мильні бульбашки', 'Ой, які гарні… Я вже трохи усміхаюсь.'],
      ['warmer', 'дати обійняти теплу грілку', 'Тепло, як обійми.'],
      ['feather', 'полоскотати пір\'їнкою', 'Ха-ха-ха! Все, сумувати неможливо!']] } },
  { id: 'grinner', name: 'Вухань-Гринер', url: './assets/models/characters/04_grinner/grinner.glb',
    walk: 'Walk_Cocky', idle: 'Idle', happy: 'Thumbs_Up', walkSpeed: 0.25,
    hello: 'Докторе! Маю план, як пришвидшити цю чергу втричі.',
    complaint: 'Вухо заклинило, поки я лагодив свій винахід. Дрібниці!',
    inBed: 'Поки лежу, накидав креслення нового ліжка. Хочете глянути?',
    illness: { name: 'Заклинене вухо', steps: [
      ['oil', 'змастити шарнір вуха олійкою', 'Скрипіти перестало! Але вухо ще стоїть.'],
      ['wrench', 'підкрутити вухо гайковим ключем', 'Клац! Ворушиться! Можна я потім позичу ключ?'],
      ['plaster', 'заклеїти подряпину пластирем', 'Як новеньке. Навіть краще, ніж було!']] } },
  { id: 'zubastyk', name: 'Зубастик', url: './assets/models/characters/06_zubastyk/zubastyk.glb',
    walk: 'Walk_Waddle', idle: 'Idle', happy: 'Joy_Bounce', walkSpeed: 0.25,
    hello: 'Гррр! Ой, це я так вітаюся. Я зовсім не кусаюся!',
    complaint: 'Зубів у мене сорок, і всі разом ниють. А язик не ховається назад у рот!',
    inBed: 'Можна я погризу подушку? Трішечки…',
    illness: { name: 'Зубна ниючка', steps: [
      ['syrup', 'дати ложку сиропу, щоб зуби не боліли', 'Ммм, солоденько! Ниють вже тихше.'],
      ['warmer', 'прикласти грілку до щоки', 'Тепленько… Зуби заспокоїлись.'],
      ['feather', 'полоскотати язик пір\'їнкою', 'Ха-ха! Язик сховався! Ой, знову виліз. Але не болить!']] } },
  { id: 'jumpy', name: 'Стрибко', url: './assets/models/characters/07_jumpy/jumpy.glb',
    walk: 'Walk_Springy', idle: 'Idle', happy: 'Joy_Hop', walkSpeed: 0.25,
    hello: 'Привіт, лікарю! Я намагався не стрибати, але стеля така приваблива!',
    complaint: 'Мої лапки-присоски клацають самі по собі: чпок-чпок-чпок! І прилипають до всього.',
    inBed: 'Тримаюся за матрац, щоб не підскочити до стелі…',
    illness: { name: 'Лапкова липучка', steps: [
      ['oil', 'змастити присоски олійкою', 'Чпок! Лапка відклеїлася від ліжка. Ой, і від носа теж!'],
      ['ointment', 'намазати лапки маззю', 'Холодненько… Присоски більше не клацають самі.'],
      ['plaster', 'заклеїти присоски пластирем на ніч', 'Ура! Сьогодні я спатиму в ліжку, а не на стелі!']] } },
  { id: 'hoopie', name: 'Ореола', url: './assets/models/characters/08_hoopie/hoopie.glb',
    walk: 'Walk_Tiptoe', idle: 'Idle', happy: 'Joy_Bounce', walkSpeed: 0.25,
    hello: 'Ой, лікарю… Світ навколо мене крутиться швидше за моє кільце!',
    complaint: 'Мій Орбітик пищить, а кільце робить вжух-вжух без зупинки. Аж голова паморочиться!',
    inBed: 'Нарешті ліжко не літає… Принаймні здається, що не літає.',
    illness: { name: 'Кільцева крутилка', steps: [
      ['wrench', 'підкрутити кільце гайковим ключем, щоб крутилося повільніше', 'Вжух… вжух… Кільце вже не свистить, а тихенько гуде.'],
      ['syrup', 'дати ложку сиропу від запаморочення', 'Ммм! Світ перестав крутитися. І Орбітик більше не пищить!'],
      ['warmer', 'дати обійняти теплу грілку', 'Тепленько… Тепер можна літати повільно-повільно.']] } },
  { id: 'puff', name: 'Хмарко', url: './assets/models/characters/09_puff/puff.glb',
    walk: 'Walk_Lumber', idle: 'Idle', happy: 'Steam_Puff', walkSpeed: 0.25,
    hello: 'Пш-ш-ш! Ой, вибачте, лікарю, я не хотів вас налякати. Це просто пара.',
    complaint: 'Голова гаряча, а сам я так роздувся, що ледь проліз у двері!',
    inBed: 'Ліжко так приємно скрипить під моєю хмаринкою… Пш-ш-ш…',
    illness: { name: 'Паровий перегрів', steps: [
      ['bubbles', 'пустити мильні бульбашки, щоб Хмарко не хвилювався', 'Які легенькі… Я вже не хвилююся. Пари стало менше.'],
      ['syrup', 'дати ложку прохолодного сиропу', 'Ох, холодненький! Голова більше не гаряча.'],
      ['feather', 'обмахнути голову пір\'їнкою', 'Фух, вітерець! Пш-ш… Усе, я знову маленька хмаринка. Ну, середня.']] } },
];
// The protagonist. walkSpeed is measured by tools/blender/dr_hoot/build.py.
const DOCTOR = { name: 'Доктор Ух', url: './assets/models/characters/05_dr_hoot/dr_hoot.glb',
  walk: 'Walk', idle: 'Idle', walkSpeed: 0.2 };
// Player movement, m/s. The Walk clip's timeScale follows the actual ground speed so feet stay planted.
const PLAYER_WALK = 1.1;
const PLAYER_RUN = 2.0;  // with Shift
const PLAYER_ACCEL = 10; // how quickly velocity catches up with the input (1/s)
const PLAYER_TURN = 14;  // yaw catch-up rate (1/s); patients use 6
const PLAYER_R = 0.3; // collision radius
const BODY_R = 0.3;   // characters' radius against each other
const LOOK = 1.2;     // how far ahead a walking patient watches for someone in the way
const TALK_DIST = 1.6;  // also the electroshocker's reach
const PC_DIST = 1.0;  // also the tool cabinet's
const ANALYSIS_TIME = 4; // seconds for the lab analyzer to process a sample
const SCAN_TIME = 3;     // seconds for the reception computer to scan a patient
const SCAN_HIT = 0.8;    // chance the scan tells an anomaly from a normal patient correctly
const COFFEE_BOOST = 1.4; // walking speed multiplier after a cup of coffee
const COFFEE_LEN = 60;    // game minutes it lasts
// The doctor works shift after shift; game time is shown on a hospital clock where one second is one minute.
const SHIFT_START = 8 * 60;  // 08:00
const SHIFT_LEN = 600;       // until 18:00
const LAST_ARRIVAL = 90;     // nobody new comes in during the last hour and a half
const ANOMALY_CHANCE = 0.3;  // per visit, while no other anomaly is in the hospital
// ?anomaly=<archetype id> makes every visit an anomaly of that archetype (tests, playtesting).
const FORCED = new URLSearchParams(location.search).get('anomaly');
const FORCE = Object.hasOwn(ARCHETYPES, FORCED ?? '') ? FORCED : null;
// About one normal visit in five is a severe case for the operating room; ?severe=1 makes every normal visit one,
// ?severe=0 none (tests). Anomalies are never severe.
const SEVERE_Q = new URLSearchParams(location.search).get('severe');
const SEVERE_CHANCE = SEVERE_Q === '1' ? 1 : SEVERE_Q === '0' ? 0 : 0.2;
const DISCHARGE_AFTER = 8;   // a cured patient rests this long before going home
// Patients come in one by one at random gaps, and only while a ward is left for them.
const ARRIVAL_GAP = [10, 30]; // game minutes between two arrivals
const REFILL_GAP = [6, 20];   // after a place frees up, how long until the next one walks in
const rand = ([a, b]) => a + Math.random() * (b - a);
const v3 = (x, z) => new THREE.Vector3(x, 0, z);

const $ = (id) => document.getElementById(id);
const log = (msg) => { $('log').textContent = msg; };

// ---------- renderer / camera ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfe3f5);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 200);
camera.position.set(2.7, 16, 11);
// Third-person camera: the mouse turns it around the doctor (pointer lock after a click on the scene), the wheel zooms.
// yaw uses the characters' convention: facing (sin yaw, cos yaw); π looks down −z, into the clinic.
const look = { yaw: Math.PI, pitch: 0.35, dist: 3.5, locked: false, wanted: false };
const LOOK_SENS = 0.0025;              // radians per pixel of mouse movement
const PITCH = [-0.15, 1.2], DIST = [1.5, 8];
const PIVOT_Y = 0.9;                   // the camera circles the doctor's head
camera.lookAt(2.7, 0, 1);              // overview until the doctor loads

scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
sun.position.set(6, 12, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17 }); // covers the west wing too
scene.add(sun);

// ---------- building ----------
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
const glass = new THREE.MeshStandardMaterial({ color: 0xaee6ff, transparent: true, opacity: 0.35, roughness: 0.05 });
const M = {
  lobbyFloor: mat(0xf2e3c6), receptionFloor: mat(0xd6eef0), wall: mat(0xfdf6ec), accent: mat(0x7cc4a8),
  frame: mat(0x5a6b7a), cross: mat(0xd93b3b), wood: mat(0xc8905a), seat: mat(0xe8735a), desk: mat(0xf0f0f0), plant: mat(0x4caf50), pot: mat(0xb5651d),
};

function box(w, h, d, material, x, y, z, parent = scene) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}
// Wall segment along X at depth z, spanning x0..x1, from y0 to y1.
const wallX = (x0, x1, z, y0 = 0, y1 = WALL_H, material = M.wall, t = 0.15) =>
  box(x1 - x0, y1 - y0, t, material, (x0 + x1) / 2, (y0 + y1) / 2, z);
const wallZ = (z0, z1, x, material = M.wall) => box(0.15, WALL_H, z1 - z0, material, x, WALL_H / 2, (z0 + z1) / 2);

// floors
box(10, 0.1, 9, M.lobbyFloor, 0, -0.05, 4.5);
box(10, 0.1, 7, M.receptionFloor, 0, -0.05, -3.5);
box(60, 0.05, 60, mat(0x9ccc65), 0, -0.13, 0); // lawn

// outer walls (front wall at z = 9 left out so the camera sees in)
wallZ(WEST_END, -7, -5); wallZ(-7, 0.2, -5); wallZ(1.4, 9, -5); // west corridor past the building; opening lobby → west corridor
wallZ(-7, STAFF_DOOR_Z - 0.45, 5); wallZ(STAFF_DOOR_Z + 0.45, 0.2, 5); wallZ(1.4, 9, 5); // staff door; opening lobby → corridor
box(0.15, WALL_H - 2.1, 0.9, M.frame, 5, (WALL_H + 2.1) / 2, STAFF_DOOR_Z);
// back wall with a wide window to the outside
wallX(-5, -3.5, -7); wallX(3.5, 5, -7);
wallX(-3.5, 3.5, -7, 0, 0.9); wallX(-3.5, 3.5, -7, 2.2, WALL_H);
wallX(-3.5, 3.5, -7, 0.9, 2.2, glass, 0.05);
// entrance posts
box(0.3, WALL_H, 0.3, M.accent, -1.2, WALL_H / 2, 9);
box(0.3, WALL_H, 0.3, M.accent, 1.2, WALL_H / 2, 9);
box(2.7, 0.3, 0.3, M.accent, 0, WALL_H, 9);

// lobby ↔ reception wall: wide window at x ∈ [-4.5, -1.3], sliding doors at x ∈ [-0.8, 0.8]
wallX(-5, -4.5, 0);
wallX(-4.5, -1.3, 0, 0, 0.8); wallX(-4.5, -1.3, 0, 2.1, WALL_H);
wallX(-4.5, -1.3, 0, 0.8, 2.1, glass, 0.05);
wallX(-1.3, -DOOR_W / 2, 0);
wallX(DOOR_W / 2, 5, 0);
wallX(-DOOR_W / 2, DOOR_W / 2, 0, 2.2, WALL_H, M.frame); // door header

const doorPanels = [-1, 1].map((side) => {
  const p = box(DOOR_W / 2, 2.2, 0.05, glass, side * DOOR_W / 4, 1.1, 0.12);
  p.castShadow = false;
  box(DOOR_W / 2, 0.06, 0.07, M.frame, 0, -1.07, 0, p); // bottom rail
  return { mesh: p, closedX: side * DOOR_W / 4, openX: side * (DOOR_W / 4 + DOOR_W / 2 - 0.05) };
});

// sign above the doors
{
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#7cc4a8'; g.fillRect(0, 0, 512, 96);
  g.fillStyle = '#fff'; g.font = 'bold 48px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('ПРИЙМАЛЬНЯ', 256, 50);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.34), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) }));
  sign.position.set(0, 2.42, 0.09);
  scene.add(sign);
}

// reception partition with the service window (hatch) at HATCH_X
{
  const hw = 0.5; // half width of the hatch
  wallX(-5, HATCH_X - hw, PARTITION_Z, 0, 0.9);
  wallX(HATCH_X + hw, 5, PARTITION_Z, 0, 0.9);
  wallX(-5, 5, PARTITION_Z, 1.8, WALL_H);
  wallX(-5, HATCH_X - hw, PARTITION_Z, 0.9, 1.8, glass, 0.04);
  wallX(HATCH_X + hw, 5, PARTITION_Z, 0.9, 1.8, glass, 0.04);
  wallX(HATCH_X - hw, HATCH_X + hw, PARTITION_Z, 0, 0.75); // lower counter body under the hatch
  box(1.3, 0.06, 0.6, M.wood, HATCH_X, 0.78, PARTITION_Z); // counter shelf
  box(1.2, 0.08, 0.2, M.frame, HATCH_X, 1.8, PARTITION_Z + 0.05); // hatch lintel
}

// ---------- staff room ----------
// The doctor's desk behind the glass: the reception computer (anomaly scanner) and a chocolate bar.
box(2.2, 0.75, 0.8, M.desk, HATCH_X, 0.375, PARTITION_Z - 1.1);
box(0.5, 0.03, 0.14, M.frame, HATCH_X, 0.765, PARTITION_Z - 1.35); // keyboard
// Monitor at the right end of the desk, turned to the chair, so the doctor stays visible through the glass.
const rcScreen = (() => {
  const g = new THREE.Group();
  box(0.08, 0.2, 0.08, M.frame, 0, 0.85, 0.03, g);
  box(0.7, 0.45, 0.05, M.frame, 0, 1.15, 0.03, g);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.4), new THREE.MeshBasicMaterial({ map: tex }));
  m.position.set(0, 1.15, 0.06);
  g.add(m);
  const x = HATCH_X + 0.7, z = PARTITION_Z - 1.2;
  g.position.set(x, 0, z);
  g.rotation.y = Math.atan2(CHAIR.x - x, CHAIR.z - z); // screen (+z) faces the chair
  scene.add(g);
  return { g: c.getContext('2d'), tex };
})();
const choco = new THREE.Group();
box(0.18, 0.02, 0.08, mat(0x5a3220), 0, 0, 0, choco);
box(0.1, 0.024, 0.084, mat(0xd4a017, { metalness: 0.6, roughness: 0.3 }), 0.05, 0, 0, choco); // foil
box(0.06, 0.026, 0.086, mat(0xc0392b), -0.02, 0, 0, choco); // label
choco.position.set(HATCH_X - 0.75, 0.765, PARTITION_Z - 1.3);
choco.rotation.y = 0.4;
scene.add(choco);

// Tall swivel chair so the owl reaches the keyboard; kept out of the colliders so the doctor can get up from it.
const chairGroup = new THREE.Group();
chairGroup.userData.noCollide = true;
{
  const g = chairGroup, s = CHAIR.seat;
  for (let i = 0; i < 5; i++) {
    const leg = box(0.28, 0.04, 0.05, M.frame, 0, 0.04, 0, g);
    leg.rotation.y = (i / 5) * Math.PI * 2;
    leg.geometry.translate(0.14, 0, 0);
  }
  box(0.05, s - 0.1, 0.05, M.frame, 0, (s - 0.1) / 2 + 0.04, 0, g);
  box(0.25, 0.02, 0.25, M.frame, 0, 0.3, 0, g); // footrest
  box(0.46, 0.08, 0.44, M.accent, 0, s - 0.04, 0, g);
  box(0.46, 0.5, 0.07, M.accent, 0, s + 0.3, -0.22, g);
  g.position.set(CHAIR.x, 0, CHAIR.z);
  scene.add(g);
}

// Coffee corner in the west end: a counter with the coffee machine.
box(0.9, 0.9, 0.55, M.wood, -4.4, 0.45, -6.6);
{
  const x = -4.4, z = -6.62, dark = mat(0x2b2f36), steel = mat(0xb8c0c8, { metalness: 0.7, roughness: 0.3 });
  box(0.36, 0.46, 0.34, dark, x, 1.13, z);                    // body
  box(0.36, 0.06, 0.1, steel, x, 1.12, z + 0.2);             // brew head
  box(0.3, 0.02, 0.12, steel, x, 0.915, z + 0.17);           // drip tray
  box(0.08, 0.09, 0.08, mat(0xffffff), x, 0.97, z + 0.17);   // cup
  box(0.04, 0.04, 0.01, mat(0xff3b30, { emissive: 0xff3b30 }), x + 0.12, 1.28, z + 0.175); // power light
  box(0.2, 0.08, 0.01, mat(0x9fe8ff, { emissive: 0x3a7fa0 }), x - 0.04, 1.28, z + 0.175);  // display
}
const staffSpots = {
  rc: { kind: 'rc', pos: new THREE.Vector3(CHAIR.x, 0, CHAIR.z) },
  coffee: { kind: 'coffee', pos: new THREE.Vector3(-4.4, 0, -5.85) },
  choco: { kind: 'choco', pos: new THREE.Vector3(HATCH_X - 0.95, 0, CHAIR.z - 0.1) },
};

// Staff door: swings into the staff room when the doctor comes near. Only he uses it.
const staffDoor = new THREE.Group();
{
  const leaf = box(0.05, 2.05, 0.88, M.wood, 0, 1.03, 0.44, staffDoor);
  leaf.castShadow = false;
  box(0.1, 0.04, 0.12, M.frame, -0.04, 0.0, 0.33, leaf); // handle
  staffDoor.position.set(4.9, 0, STAFF_DOOR_Z - 0.45);
  scene.add(staffDoor);
}

// lobby chairs: two rows facing the aisle
const chairSpots = [];
function chair(x, z, facing) {
  const g = new THREE.Group();
  box(0.6, 0.1, 0.55, M.seat, 0, 0.45, 0, g);
  box(0.6, 0.6, 0.08, M.seat, 0, 0.8, -0.26, g);
  for (const [lx, lz] of [[-0.25, -0.22], [0.25, -0.22], [-0.25, 0.22], [0.25, 0.22]]) box(0.05, 0.4, 0.05, M.frame, lx, 0.2, lz, g);
  g.position.set(x, 0, z);
  g.rotation.y = facing;
  scene.add(g);
  const front = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
  chairSpots.push({ pos: new THREE.Vector3(x, 0, z).addScaledVector(front, 0.75), facing, taken: false });
}
for (let i = 0; i < 5; i++) {
  chair(-4.2, 2.2 + i * 0.8, Math.PI / 2);
  chair(4.2, 2.2 + i * 0.8, -Math.PI / 2);
}
// plants
for (const [x, z] of [[-4.4, 8.3], [4.4, 8.3], [-4.4, 6.5]]) { // none in front of the wing openings
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.4, 16), M.pot);
  pot.position.set(x, 0.2, z); pot.castShadow = true; scene.add(pot);
  const bush = new THREE.Mesh(new THREE.SphereGeometry(0.38, 16, 12), M.plant);
  bush.position.set(x, 0.75, z); bush.castShadow = true; scene.add(bush);
}

// Ward computer: desk by the north wall, monitor facing the room (and the camera).
// The screen is a canvas, redrawn by drawScreens() whenever a ward's state changes.
function computer(ward) {
  const x = ward.side * 7.9, z = ward.zc - 1.65;
  box(1.0, 0.75, 0.5, M.desk, x, 0.375, z);
  box(0.08, 0.25, 0.08, M.frame, x, 0.875, z - 0.1);
  box(0.7, 0.45, 0.05, M.frame, x, 1.2, z - 0.1);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const tex = new THREE.CanvasTexture(c);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.4), new THREE.MeshBasicMaterial({ map: tex }));
  screen.position.set(x, 1.2, z - 0.07);
  scene.add(screen);
  return { kind: 'pc', ward, pos: new THREE.Vector3(x, 0, ward.zc - 1.1), g: c.getContext('2d'), tex };
}

// Tool cabinet by the north wall, right of the computer: glass front, a jar per tool on two shelves.
function cabinet(ward) {
  const x = ward.side * 8.8, z = ward.zc - 1.75;
  box(0.7, 1.4, 0.04, M.desk, x, 0.7, z - 0.18); // hollow: back, sides, top, bottom
  for (const sx of [-0.33, 0.33]) box(0.04, 1.4, 0.4, M.desk, x + sx, 0.7, z);
  box(0.7, 0.04, 0.4, M.desk, x, 1.38, z);
  box(0.7, 0.1, 0.4, M.desk, x, 0.05, z);
  box(0.62, 1.2, 0.02, glass, x, 0.72, z + 0.21);
  box(0.2, 0.06, 0.02, M.cross, x, 1.3, z + 0.21);
  box(0.06, 0.2, 0.02, M.cross, x, 1.3, z + 0.21);
  TOOL_COLORS.forEach((c, i) => {
    const y = i < 4 ? 0.5 : 0.95;
    if (i % 4 === 0) box(0.62, 0.03, 0.34, M.frame, x, y - 0.015, z);
    box(0.1, 0.16, 0.1, mat(c), x - 0.22 + (i % 4) * 0.147, y + 0.08, z + 0.05);
  });
  return { kind: 'cab', ward, pos: new THREE.Vector3(x, 0, ward.zc - 1.1) };
}

// Room name over each door: a small board sticking out of the corridor wall, readable from both ends of the corridor
// (and from the camera behind the doctor). Two planes back to back, so neither side shows mirrored text.
function doorSign(text, side, zc) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#7cc4a8'; g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = 76;
  do g.font = `bold ${size -= 4}px system-ui`; while (g.measureText(text).width > 470);
  g.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(c);
  const sign = new THREE.Group();
  box(1.0, 0.34, 0.03, M.frame, 0, 0, 0, sign);
  for (const back of [0, 1]) {
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.3), new THREE.MeshBasicMaterial({ map: tex }));
    face.position.z = back ? -0.017 : 0.017;
    face.rotation.y = back * Math.PI;
    sign.add(face);
  }
  sign.position.set(side * (CORRIDOR_X - 0.58), 2.3, zc);
  scene.add(sign);
}

// A room off a wing corridor (side 1 = east, -1 = west): the corridor wall with a door gap at zc ± 0.5,
// the wall to the room north of it (north: false where the wing's end wall is already there) and a door sign.
function roomShell(side, zc, north, name) {
  const cx = side * CORRIDOR_X, ox = side * EAST_X;
  wallZ(zc - 2, zc - 0.5, cx); wallZ(zc + 0.5, zc + 2, cx);
  box(0.15, WALL_H - 2.1, 1, M.frame, cx, (WALL_H + 2.1) / 2, zc);
  if (north) wallX(Math.min(cx, ox), Math.max(cx, ox), zc - 2);
  doorSign(name, side, zc);
}

// A ward: one bed by the outer wall, computer and tool cabinet by the north wall. The west wards mirror the east ones.
const wardFurniture = new Set(); // computers and cabinets fade out like walls when they hide the doctor
function ward(side, zc, north, name) {
  roomShell(side, zc, north, name);
  // bed along z, headboard at -z
  const bx = side * (EAST_X - 0.8);
  box(1.0, 0.35, 1.8, M.frame, bx, 0.2, zc);
  box(0.95, 0.15, 1.75, M.desk, bx, 0.45, zc);
  box(0.7, 0.1, 0.35, mat(0xcfe8ff), bx, 0.57, zc - 0.65);
  box(1.0, 0.8, 0.08, M.accent, bx, 0.4, zc - 0.92);
  box(0.4, 0.5, 0.4, M.wood, bx, 0.25, zc - 1.4); // nightstand
  const w = { zc, side, bedX: bx, taken: false };
  const furniture = scene.children.length;
  w.pc = computer(w);
  w.cab = cabinet(w);
  scene.children.slice(furniture).forEach((o) => wardFurniture.add(o));
  return w;
}

// wards: one bed each, doors from the corridor
box(EAST_X - 5, 0.1, 16, M.receptionFloor, (5 + EAST_X) / 2, -0.05, 1);
wallZ(-7, 9, EAST_X);
wallX(5, EAST_X, -7);
// west wing: floor, outer wall, north end wall
box(EAST_X - 5, 0.1, 9 - WEST_END, M.receptionFloor, -(5 + EAST_X) / 2, -0.05, (9 + WEST_END) / 2);
wallZ(WEST_END, 9, -EAST_X);
wallX(-EAST_X, -5, WEST_END);
// Every room with a bed: the six ordinary wards, then quarantine (a ward whose door locks). Names for the UI:
// label (screen, dialog titles), at ("лежить у …"), of ("комп'ютер …"), to (the "Направити …" tail, "іде …").
const wards = [...WARD_Z.map((zc, i) => ward(1, zc, i > 0, `Палата ${i + 1}`)),
  ...WEST_Z.slice(0, 2).map((zc, i) => ward(-1, zc, true, `Палата ${i + 5}`))]
  .map((w, i) => Object.assign(w, { key: `ward${i + 1}`, kind: 'ward', label: `палата ${i + 1}`, at: `у палаті ${i + 1}`,
    of: `палати ${i + 1}`, to: `до палати ${i + 1}` }));
// Operating room: the table in the middle (a patient lies on it just like in bed) under a big round lamp on a stand,
// the surgical cabinet by the north wall and a heart monitor at the table's foot, drawn by drawOR().
// Not a referral destination: the doctor walks a severe case here from its ward (toOR).
const orRoom = (() => {
  const side = -1, zc = WEST_Z[4], tx = side * 8.5, tz = zc + 0.2;
  roomShell(side, zc, true, 'Операційна');
  const furniture = scene.children.length;
  const steel = mat(0xb8c0c8, { metalness: 0.6, roughness: 0.35 });
  box(0.5, 0.45, 0.7, steel, tx, 0.225, tz); // pedestal
  box(0.8, 0.08, 1.9, mat(0x7cc4a8), tx, 0.485, tz); // top, at bed height
  box(0.6, 0.08, 0.3, mat(0xcfe8ff), tx, 0.56, tz - 0.7); // pillow
  // the lamp: a pole by the outer wall, an arm over the table, a wide dome glowing underneath, and its light
  const lx = side * 10.05, lz = tz - 0.5;
  box(0.08, 2.3, 0.08, steel, lx, 1.15, lz);
  box(Math.abs(tx - lx), 0.06, 0.06, steel, (tx + lx) / 2, 2.27, lz);
  const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.46, 0.16, 32), mat(0xf5f5f5, { roughness: 0.4 }));
  dome.position.set(tx, 2.17, lz);
  dome.castShadow = true;
  scene.add(dome);
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.02, 32), mat(0xfff6d0, { emissive: 0xfff2c0, emissiveIntensity: 1.2 }));
  glow.position.set(tx, 2.08, lz);
  scene.add(glow);
  const spot = new THREE.SpotLight(0xfff6e0, 5, 4, 0.55, 0.5);
  spot.position.set(tx, 2.0, lz);
  spot.target.position.set(tx, 0.5, tz);
  scene.add(spot, spot.target);
  // surgical cabinet: like a ward's, with a green cross and just the three surgical tools
  const cx = side * 9.7, cz = zc - 1.75;
  box(0.7, 1.4, 0.04, M.desk, cx, 0.7, cz - 0.18);
  for (const sx of [-0.33, 0.33]) box(0.04, 1.4, 0.4, M.desk, cx + sx, 0.7, cz);
  box(0.7, 0.04, 0.4, M.desk, cx, 1.38, cz);
  box(0.7, 0.1, 0.4, M.desk, cx, 0.05, cz);
  box(0.62, 1.2, 0.02, glass, cx, 0.72, cz + 0.21);
  box(0.2, 0.06, 0.02, M.accent, cx, 1.3, cz + 0.21);
  box(0.06, 0.2, 0.02, M.accent, cx, 1.3, cz + 0.21);
  box(0.62, 0.03, 0.34, M.frame, cx, 0.785, cz);
  [0x6fb8e8, 0xb8c0c8, 0xe8735a].forEach((c, i) => box(0.12, 0.16, 0.1, mat(c), cx - 0.18 + i * 0.18, 0.88, cz + 0.05));
  // heart monitor on a pole, turned to the table and the camera
  const mon = new THREE.Group();
  box(0.3, 0.04, 0.3, M.frame, 0, 0.02, 0, mon);
  box(0.05, 1.1, 0.05, M.frame, 0, 0.57, 0, mon);
  box(0.56, 0.4, 0.06, M.frame, 0, 1.3, 0, mon);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const tex = new THREE.CanvasTexture(c);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.33), new THREE.MeshBasicMaterial({ map: tex }));
  screen.position.set(0, 1.3, 0.035);
  mon.add(screen);
  mon.position.set(side * 9.9, 0, tz + 0.75);
  mon.rotation.y = -side * 0.5;
  scene.add(mon);
  scene.children.slice(furniture).forEach((o) => wardFurniture.add(o));
  const room = { key: 'or', kind: 'or', label: 'операційна', side, zc, taken: false,
    table: v3(tx, tz), bedside: v3(tx - side * 0.9, tz + 0.5), monitor: { g: c.getContext('2d'), tex } };
  room.cab = { kind: 'orCab', room, pos: v3(cx, zc - 1.1) };
  return room;
})();

// Laboratory: a bench along the north wall with the analyzer (a small screen, drawn by drawLab()), flasks and a rack
// of test tubes, and a shelf of jars on the outer wall. Not a referral destination: the doctor brings the samples.
// queue: patients whose samples sit in the analyzer, the first one being analysed; run: token of the running analysis;
// last: the latest result, for the screen.
const lab = (() => {
  const side = -1, zc = WEST_Z[3];
  roomShell(side, zc, true, 'Лабораторія');
  const furniture = scene.children.length;
  const z = zc - 1.65, ax = side * 8.2;
  box(2.8, 0.75, 0.6, M.desk, side * 8.6, 0.375, z); // bench
  box(2.8, 0.04, 0.62, M.frame, side * 8.6, 0.77, z); // worktop
  // analyzer: a squat grey machine with a sample slot on top and a screen facing the room
  box(0.7, 0.45, 0.45, mat(0xd6dde4), ax, 1.0, z - 0.02);
  box(0.26, 0.05, 0.14, M.frame, ax - 0.12, 1.24, z - 0.05);
  box(0.03, 0.03, 0.01, mat(0x7ee0a8, { emissive: 0x7ee0a8 }), ax + 0.28, 0.84, z + 0.21); // power light
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const tex = new THREE.CanvasTexture(c);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.25), new THREE.MeshBasicMaterial({ map: tex }));
  screen.position.set(ax + 0.1, 1.05, z + 0.211);
  scene.add(screen);
  // flasks: round-bottomed and tall, with coloured liquid; a rack of test tubes
  const flask = (x, dz, color, tall) => {
    const liquid = mat(color, { emissive: color, emissiveIntensity: 0.25 });
    const body = new THREE.Mesh(tall ? new THREE.CylinderGeometry(0.06, 0.09, 0.22, 16) : new THREE.SphereGeometry(0.09, 16, 12), glass);
    body.position.set(x, 0.79 + (tall ? 0.11 : 0.09), z + dz);
    scene.add(body);
    const fill = new THREE.Mesh(tall ? new THREE.CylinderGeometry(0.07, 0.085, 0.1, 16) : new THREE.SphereGeometry(0.075, 16, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), liquid);
    fill.position.set(x, 0.79 + (tall ? 0.05 : 0.09), z + dz);
    scene.add(fill);
    box(0.04, tall ? 0.06 : 0.1, 0.04, glass, x, 0.79 + (tall ? 0.25 : 0.22), z + dz); // neck
  };
  flask(side * 7.55, 0.1, 0x9b59b6, false);
  flask(side * 7.8, -0.1, 0x6fb8e8, true);
  flask(side * 9.2, 0.05, 0x7ee0a8, false);
  flask(side * 9.45, -0.12, 0xf2c14e, true);
  box(0.42, 0.04, 0.12, M.wood, side * 9.9, 0.84, z + 0.08); // test tube rack
  [0xe8735a, 0x6fb8e8, 0xf2c14e, 0x7ee0a8].forEach((col, i) =>
    box(0.035, 0.14, 0.035, mat(col), side * 9.9 - 0.15 + i * 0.1, 0.9, z + 0.08));
  // shelf with jars on the outer wall
  const sx = side * 10.2;
  box(0.3, 0.04, 1.4, M.wood, sx, 1.45, zc - 0.2);
  [0xc8905a, 0x8fe3ff, 0xe8735a, 0xf5f5f5].forEach((col, i) =>
    box(0.14, 0.2, 0.14, mat(col), sx, 1.57, zc - 0.7 + i * 0.33));
  scene.children.slice(furniture).forEach((o) => wardFurniture.add(o));
  const room = { key: 'lab', kind: 'lab', label: 'лабораторія', side, zc, queue: [], run: null, last: null, progress: 0 };
  room.analyzer = { kind: 'lab', room, pos: v3(ax, zc - 1.0), g: c.getContext('2d'), tex };
  return room;
})();

// X-ray room: a screen stand by the north wall (the patient stands in front of it, facing the room) and a console
// desk with a tall viewer monitor, drawn by drawXray(). Not a bed: it does not count for the arrivals cap.
const xray = (() => {
  const side = -1, zc = WEST_Z[2];
  roomShell(side, zc, true, 'Рентген');
  const furniture = scene.children.length;
  // stand: base, two posts, the pale detector panel, a yellow-black warning stripe on top
  const sx = side * 9.6, sz = zc - 1.6;
  box(1.1, 0.06, 0.5, M.frame, sx, 0.03, sz);
  for (const dx of [-0.52, 0.52]) box(0.07, 2.0, 0.07, M.frame, sx + dx, 1.0, sz);
  box(0.96, 1.5, 0.06, mat(0xcfe8ff, { emissive: 0x2a4a60 }), sx, 1.0, sz);
  box(0.96, 0.08, 0.07, mat(0xf2c14e), sx, 1.8, sz);
  // console: a desk, a keyboard, a portrait viewer monitor facing the room
  const cx = side * 7.8, cz = zc - 1.65;
  box(1.0, 0.75, 0.5, M.desk, cx, 0.375, cz);
  box(0.5, 0.03, 0.14, M.frame, cx, 0.765, cz + 0.1);
  box(0.08, 0.3, 0.08, M.frame, cx, 0.9, cz - 0.1);
  box(0.56, 0.7, 0.05, M.frame, cx, 1.35, cz - 0.1);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 320;
  const tex = new THREE.CanvasTexture(c);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.625), new THREE.MeshBasicMaterial({ map: tex }));
  screen.position.set(cx, 1.35, cz - 0.07);
  scene.add(screen);
  scene.children.slice(furniture).forEach((o) => wardFurniture.add(o));
  const room = { key: 'xray', kind: 'xray', label: 'рентген', to: 'на рентген', side, zc, taken: false,
    stand: v3(sx, sz + 0.5), shot: null }; // shot: the last picture on the viewer, { p, result } or result 'running'
  room.console = { kind: 'xray', room, pos: v3(cx, zc - 1.1), g: c.getContext('2d'), tex };
  return room;
})();
const quarantine = Object.assign(ward(-1, WEST_Z[5], WEST_Z[5] - 2 > WEST_END, 'Карантин'),
  { key: 'quarantine', kind: 'quarantine', label: 'карантин', at: 'у карантині', of: 'карантину', to: 'в карантин' });
wards.push(quarantine);
// Quarantine door: a leaf hinged at the north jamb, swinging into the room. updateDoors opens it only for the doctor,
// the patient walking in, and a cured patient going home; whatever is inside stays locked in.
quarantine.door = new THREE.Group();
{
  const d = quarantine.door, cx = quarantine.side * CORRIDOR_X;
  const leaf = box(0.06, 2.08, 0.98, mat(0xd6dde4), 0, 1.05, 0.49, d);
  leaf.castShadow = false;
  box(0.08, 0.5, 0.4, glass, 0, 0.5, 0, leaf); // a small window at eye height (in leaf space: y 1.55)
  box(0.1, 0.04, 0.12, M.frame, quarantine.side * -0.05, 0, 0.34, leaf); // handle (corridor side)
  box(0.1, 0.12, 0.5, M.cross, quarantine.side * -0.04, -0.25, 0, leaf); // red warning band
  d.position.set(cx, 0, quarantine.zc - 0.5);
  d.shake = 0;
  scene.add(d);
}
// A ward's patient: in its bed, or away in the operating room (the ward stays its own meanwhile).
const inWard = (w) => patients.find((p) => p.ward === w && (p.inBed || p.orTrip));
const inQuarantine = (p) => p.ward === quarantine && p.inBed;
// Everywhere the doctor can refer a patient from the service window: the rooms with a bed, and the X-ray.
// Fields every kind has: key (for __game.refer), to (the option's "Направити …" tail), taken.
const rooms = [...wards, xray];
// A patient may go to the X-ray once per visit.
const mayUse = (p, r) => r.kind !== 'xray' || !p.xray;
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// X-ray viewer: glowing cartoon bones on a dark blue film. A normal patient has a plain, friendly skeleton;
// an anomaly's is clearly off (extra ribs, a second little skull, sharp teeth, a curly tail) so a child can tell at once.
function drawSkeleton(g, weird) {
  const bone = (x0, y0, x1, y1, w = 9) => {
    g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    for (const [x, y] of [[x0, y0], [x1, y1]]) { g.beginPath(); g.arc(x, y, w * 0.75, 0, Math.PI * 2); g.fill(); }
  };
  const skull = (x, y, r, teeth) => {
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0d2236';
    for (const dx of [-0.4, 0.4]) { g.beginPath(); g.arc(x + dx * r, y - 0.1 * r, 0.24 * r, 0, Math.PI * 2); g.fill(); }
    g.beginPath(); g.moveTo(x, y + 0.12 * r); g.lineTo(x - 0.1 * r, y + 0.3 * r); g.lineTo(x + 0.1 * r, y + 0.3 * r); g.fill(); // nose
    if (teeth) { // a row of pointy teeth
      for (let i = -3; i < 3; i++) {
        g.beginPath(); g.moveTo(x + i * 0.16 * r, y + 0.5 * r); g.lineTo(x + (i + 0.5) * 0.16 * r, y + 0.78 * r);
        g.lineTo(x + (i + 1) * 0.16 * r, y + 0.5 * r); g.fill();
      }
    } else { g.lineWidth = 3; g.strokeStyle = '#0d2236'; g.beginPath(); g.arc(x, y + 0.35 * r, 0.3 * r, 0.2, Math.PI - 0.2); g.stroke(); }
    g.fillStyle = g.strokeStyle = '#e8f6ff';
  };
  g.fillStyle = g.strokeStyle = '#e8f6ff';
  g.lineCap = 'round';
  g.shadowColor = '#9fe8ff'; g.shadowBlur = 10;
  const cx = 128, top = 62;
  skull(cx, top + 26, 30, weird);
  if (weird) skull(cx + 62, top + 50, 17, true); // a second little head on the shoulder
  for (let y = top + 62; y < top + 170; y += 11) { g.beginPath(); g.roundRect(cx - 6, y, 12, 8, 3); g.fill(); } // spine
  const ribs = weird ? 7 : 4;
  g.lineWidth = 6;
  for (let i = 0; i < ribs; i++) {
    const y = top + 72 + i * (weird ? 11 : 17), w = 38 - i * (weird ? 2 : 4);
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx, y); g.quadraticCurveTo(cx + s * w, y - 6, cx + s * (w - 6), y + 14); g.stroke(); }
  }
  bone(cx - 30, top + 66, cx + 30, top + 66, 7); // shoulders
  bone(cx - 30, top + 66, cx - 50, top + 125); bone(cx - 50, top + 125, cx - 56, top + 172, 7); // arms
  bone(cx + 30, top + 66, cx + 50, top + 125); bone(cx + 50, top + 125, cx + 56, top + 172, 7);
  g.beginPath(); g.ellipse(cx, top + 176, 30, 13, 0, 0, Math.PI * 2); g.fill(); // pelvis
  bone(cx - 16, top + 180, cx - 22, top + 222); bone(cx + 16, top + 180, cx + 22, top + 222); // legs, short and stubby
  if (weird) { // a curly tail
    g.lineWidth = 7; g.beginPath(); g.moveTo(cx + 24, top + 184);
    g.bezierCurveTo(cx + 90, top + 200, cx + 100, top + 140, cx + 76, top + 150); g.stroke();
    g.beginPath(); g.moveTo(cx + 70, top + 142); g.lineTo(cx + 86, top + 146); g.lineTo(cx + 72, top + 158); g.fill(); // spiky tip
  }
  g.shadowBlur = 0;
}
function drawXray() {
  const { g, tex } = xray.console, shot = xray.shot;
  const at = patients.find((p) => p.ward === xray && p.atXray);
  g.fillStyle = '#0d2236'; g.fillRect(0, 0, 256, 320);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const title = (text, color) => {
    g.fillStyle = color;
    let size = 30;
    do g.font = `bold ${size -= 2}px system-ui`; while (g.measureText(text).width > 236);
    g.fillText(text, 128, 26);
  };
  if (shot?.result === 'running') {
    title('ЗНІМОК…', '#ffd166');
    g.fillStyle = '#7cc4a8'; g.font = '20px system-ui'; g.fillText(shot.p.cfg.name, 128, 160);
  } else if (shot) {
    const weird = shot.result === 'anomaly';
    drawSkeleton(g, weird);
    title(weird ? '⚠ АНОМАЛІЯ' : '✓ НОРМА', weird ? '#ff6b6b' : '#7ee0a8');
    g.fillStyle = '#fff'; g.font = '18px system-ui'; g.fillText(shot.p.cfg.name, 128, 302);
  } else {
    title('РЕНТГЕН', '#7cc4a8');
    g.fillStyle = '#8a97a8'; g.font = '20px system-ui';
    g.fillText(at ? `Готово: ${at.cfg.name}` : 'нікого немає', 128, 160);
  }
  tex.needsUpdate = true;
}

function drawScreens() {
  for (const w of wards) {
    const p = inWard(w), { g, tex } = w.pc;
    const [bg, fg, title] = !p ? ['#1d2330', '#8a97a8', 'ВІЛЬНО']
      : p.analysis === 'anomaly' ? ['#7a0f1a', '#fff', '⚠ АНОМАЛІЯ']
      : p.analysis === 'normal' && p.severe ? [p.healed ? '#1f9d55' : '#8a4b00', '#fff', p.healed ? '✓ ЗДОРОВИЙ'
        : p.opStep ? `ОПЕРАЦІЯ ${p.opStep}/${SURGERY.length}` : 'ПОТРІБНА ОПЕРАЦІЯ']
      : p.analysis === 'normal' ? [p.healed ? '#1f9d55' : '#0f5132', '#fff', p.healed ? '✓ ЗДОРОВИЙ'
        : p.step ? `ЛІКУВАННЯ ${p.step}/${p.cfg.illness.steps.length}` : 'НОРМА']
      : p.examined ? ['#1d2330', '#ffd166', 'ЗРАЗОК У ЛАБІ'] : ['#1d2330', '#7cc4a8', 'ЧЕКАЮ ЗРАЗОК'];
    g.fillStyle = bg; g.fillRect(0, 0, 256, 160);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = 34;
    do g.font = `bold ${size -= 2}px system-ui`; while (g.measureText(title).width > 236);
    g.fillText(title, 128, 65);
    g.font = '20px system-ui'; g.fillText(p ? p.cfg.name + (p.inBed ? '' : ' · в операційній') : w.label, 128, 115);
    tex.needsUpdate = true;
  }
}

// Lab analyzer screen: idle, the running analysis with a progress bar and how many samples wait, or the last result.
function drawLab() {
  const { g, tex } = lab.analyzer, p = lab.queue[0], last = lab.last;
  g.fillStyle = '#1d2330'; g.fillRect(0, 0, 256, 160);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const line = (text, y, font, color) => {
    g.fillStyle = color;
    let size = parseInt(font) + 2;
    do g.font = font.replace(/\d+px/, `${size -= 2}px`); while (g.measureText(text).width > 236);
    g.fillText(text, 128, y);
  };
  if (p) {
    line('АНАЛІЗ…', 34, 'bold 30px system-ui', '#ffd166');
    line(p.cfg.name, 78, '22px system-ui', '#fff');
    g.fillStyle = '#3a4456'; g.fillRect(28, 104, 200, 14);
    g.fillStyle = '#7cc4a8'; g.fillRect(28, 104, 200 * lab.progress, 14);
    if (lab.queue.length > 1) line(`у черзі: ${lab.queue.length - 1}`, 142, '18px system-ui', '#8a97a8');
  } else if (last) {
    const weird = last.analysis === 'anomaly';
    line(weird ? '⚠ АНОМАЛІЯ' : last.severe ? 'ПОТРІБНА ОПЕРАЦІЯ' : '✓ НОРМА', 50, 'bold 32px system-ui',
      weird ? '#ff6b6b' : last.severe ? '#ffd166' : '#7ee0a8');
    line(last.cfg.name, 104, '22px system-ui', '#fff');
  } else {
    line('АНАЛІЗАТОР', 55, 'bold 30px system-ui', '#7cc4a8');
    line('покладіть зразок', 108, '20px system-ui', '#8a97a8');
  }
  tex.needsUpdate = true;
}

// Heart monitor: the patient on the table, a calm heartbeat line and how far the operation got.
function drawOR() {
  const { g, tex } = orRoom.monitor, p = patients.find((q) => q.orTrip === 'table');
  g.fillStyle = '#0d1a14'; g.fillRect(0, 0, 256, 160);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (!p) {
    g.fillStyle = '#7cc4a8'; g.font = 'bold 28px system-ui'; g.fillText('ОПЕРАЦІЙНА', 128, 60);
    g.fillStyle = '#8a97a8'; g.font = '20px system-ui'; g.fillText('вільно', 128, 105);
  } else {
    g.fillStyle = '#fff'; g.font = '20px system-ui'; g.fillText(p.cfg.name, 128, 20);
    g.strokeStyle = '#7ee0a8'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 72);
    for (let x = 20; x < 256; x += 64) { g.lineTo(x, 72); g.lineTo(x + 6, 44); g.lineTo(x + 12, 98); g.lineTo(x + 18, 72); }
    g.lineTo(256, 72); g.stroke();
    const n = p.opStep, all = SURGERY.length;
    g.fillStyle = '#3a4456'; g.fillRect(28, 118, 200, 12);
    g.fillStyle = '#7cc4a8'; g.fillRect(28, 118, 200 * n / all, 12);
    g.fillStyle = p.healed ? '#7ee0a8' : '#ffd166'; g.font = 'bold 18px system-ui';
    g.fillText(p.healed ? '✓ ОПЕРАЦІЮ ЗАВЕРШЕНО' : n ? `ОПЕРАЦІЯ ${n}/${all}` : 'ГОТУЄМОСЬ', 128, 146);
  }
  tex.needsUpdate = true;
}

// Static colliders for the player: XZ footprints of everything between ankle and head height.
// Door panels are left out, they slide open when someone comes near.
scene.updateMatrixWorld();
const colliders = [];
{
  const doorMeshes = new Set(doorPanels.flatMap((d) => [d.mesh, ...d.mesh.children]));
  staffDoor.traverse((o) => doorMeshes.add(o));
  quarantine.door.traverse((o) => doorMeshes.add(o));
  scene.traverse((o) => {
    if (!o.isMesh || doorMeshes.has(o) || o.parent.userData.noCollide) return;
    const b = new THREE.Box3().setFromObject(o);
    if (b.max.y > 0.2 && b.min.y < 1.2 && b.max.x - b.min.x < 30) colliders.push(b);
  });
}

// Tall pieces (walls, posts) and ward furniture fade out when they stand between the camera and the doctor.
// Each gets its own material copy so only the blocking segment turns see-through.
const occluders = [];
scene.traverse((o) => {
  if (!o.isMesh || !o.geometry.parameters || (o.geometry.parameters.height < 1.5 && !wardFurniture.has(o))) return;
  o.material = o.material.clone();
  o.userData.baseOpacity = o.material.opacity;
  occluders.push(o);
});
const ray = new THREE.Raycaster();
function fadeOccluders(dt) {
  const hit = new Set();
  const head = doctor.root.position.clone();
  for (const y of [0.3, 0.9]) {
    head.y = y;
    const dir = head.clone().sub(camera.position);
    ray.set(camera.position, dir.normalize());
    ray.far = head.distanceTo(camera.position);
    for (const h of ray.intersectObjects(occluders, false)) hit.add(h.object);
  }
  const k = Math.min(1, dt * 8);
  for (const o of occluders) {
    const m = o.material, goal = hit.has(o) ? 0.2 : o.userData.baseOpacity;
    m.opacity += (goal - m.opacity) * k;
    const see = m.opacity < 0.999;
    if (see !== m.transparent) { m.transparent = see; m.depthWrite = !see; m.needsUpdate = true; } // OPAQUE define changes
  }
}
function pushOut(pos, r) {
  for (const b of colliders) {
    const dx = pos.x - THREE.MathUtils.clamp(pos.x, b.min.x, b.max.x);
    const dz = pos.z - THREE.MathUtils.clamp(pos.z, b.min.z, b.max.z);
    const d = Math.hypot(dx, dz);
    if (d >= r || d === 0) continue;
    pos.x += (dx / d) * (r - d);
    pos.z += (dz / d) * (r - d);
  }
}

// Everyone on their feet, for character-vs-character collisions.
function bodies() {
  const list = patients.filter((p) => p.root.visible && !p.inBed && p.orTrip !== 'table');
  if (doctor) list.push(doctor);
  return list;
}
const standing = (o) => !o.path.length || o.talking;

// Resolve overlaps. Standing patients hold their place (the player can't shove them off a chair or out of the queue),
// the doctor always gives way, two walking patients split the push.
function separate() {
  const list = bodies();
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const pa = a.root.position, pb = b.root.position;
      let dx = pb.x - pa.x, dz = pb.z - pa.z;
      let d = Math.hypot(dx, dz);
      if (d >= 2 * BODY_R) continue;
      if (d === 0) { dx = 1; dz = 0; d = 1e-6; }
      const overlap = 2 * BODY_R - d;
      let wa = standing(a) ? 0 : 1, wb = standing(b) ? 0 : 1;
      if (a === doctor) { wa = 1; wb = 0; } else if (b === doctor) { wa = 0; wb = 1; }
      if (!wa && !wb) continue;
      const ka = (overlap * wa) / (wa + wb) / d, kb = (overlap * wb) / (wa + wb) / d;
      pa.x -= dx * ka; pa.z -= dz * ka;
      pb.x += dx * kb; pb.z += dz * kb;
    }
  }
}

// ---------- patients ----------
const DOOR_FRONT = new THREE.Vector3(0, 0, 1.3);
const DOOR_BACK = new THREE.Vector3(0, 0, -1.2);
const queueSlot = (i) => new THREE.Vector3(HATCH_X, 0, PARTITION_Z + 0.7 + i * 0.9);

let speed = 2; // game-time multiplier, applied to both movement and animation so feet stay in sync
$('speed').oninput = (e) => { speed = +e.target.value; $('speedVal').textContent = speed; };

class Patient {
  constructor(cfg, gltf) {
    this.cfg = cfg;
    this.root = gltf.scene;
    this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = Object.fromEntries(gltf.animations.map((c) => [c.name, this.mixer.clipAction(c)]));
    this.path = [];
    this.current = null;
  }
  play(name, fade = 0.25) {
    const next = this.actions[name];
    if (!next || next === this.current) return;
    next.reset().fadeIn(fade).play();
    if (this.current) this.current.fadeOut(fade);
    this.current = next;
  }
  walkTo(points, onArrive) {
    this.path = points.map((p) => p.clone());
    this.onArrive = onArrive;
    this.play(this.cfg.walk);
  }
  face(angle) { this.targetYaw = angle; }
  // Local avoidance: wait for the doctor to step aside (the player moves him), veer around other patients.
  // Bends `dir` in place; returns the doctor if he blocks the way.
  steer(dir, dist) {
    const pos = this.root.position;
    const right = new THREE.Vector3(-dir.z, 0, dir.x);
    let veer = 0;
    for (const o of bodies()) {
      if (o === this) continue;
      const rx = o.root.position.x - pos.x, rz = o.root.position.z - pos.z;
      const along = rx * dir.x + rz * dir.z;
      const across = rx * right.x + rz * right.z;
      if (along <= 0 || along > Math.min(LOOK, dist + BODY_R) || Math.abs(across) >= 2 * BODY_R) continue;
      if (o === doctor) return o;
      // Dead ahead: keep right, so two patients meeting head-on pass each other.
      veer += (across > 0 ? -1 : 1) * 1.5 * (1 - along / LOOK);
    }
    if (veer) dir.addScaledVector(right, veer).normalize();
    return null;
  }
  update(dt) {
    this.mixer.update(dt);
    const pos = this.root.position;
    if (this.path.length && !this.talking) {
      const target = this.path[0];
      const to = target.clone().sub(pos);
      const dist = to.length();
      const step = this.cfg.walkSpeed * dt;
      if (dist <= step) {
        this.targetYaw = Math.atan2(to.x, to.z); // models face +Z
        pos.copy(target);
        this.path.shift();
        if (!this.path.length) {
          this.play(this.cfg.idle);
          const cb = this.onArrive; this.onArrive = null; cb?.();
        }
      } else if (this.path.length > 1 && dist < BODY_R && (target.equals(DOOR_FRONT) || target.equals(DOOR_BACK))) {
        // Close enough to a door point on the way: pass it. Patients crossing the door from both sides
        // push each other off the exact point, and nobody would ever get through.
        this.path.shift();
      } else {
        const dir = to.divideScalar(dist);
        const waitFor = this.steer(dir, dist);
        this.targetYaw = Math.atan2(dir.x, dir.z);
        if (waitFor) this.play(this.cfg.idle);
        else { this.play(this.cfg.walk); pos.addScaledVector(dir, step); }
      }
    }
    if (this.targetYaw !== undefined) {
      let d = this.targetYaw - this.root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.root.rotation.y += d * Math.min(1, dt * (this.turnRate ?? 6));
    }
  }
}

// Short real-time animations (zap, shrinking, analysis countdown). step(k) gets progress 0..1.
let tweens = [];
function tween(dur, step, done) { tweens.push({ t: 0, dur, step, done }); }
function updateTweens(dt) {
  const list = tweens;
  tweens = []; // done() may start new tweens
  const keep = list.filter((tw) => {
    tw.t += dt;
    const k = Math.min(1, tw.t / tw.dur);
    tw.step?.(k);
    if (k < 1) return true;
    tw.done?.();
    return false;
  });
  tweens = keep.concat(tweens);
}

// Emissive tint over the whole model; null restores the original colours.
function tint(p, hex) {
  p.root.traverse((o) => {
    if (!o.isMesh || !o.material.emissive) return;
    const m = o.material;
    m.userData.emissive ??= m.emissive.getHex();
    m.emissive.setHex(hex ?? m.userData.emissive);
  });
}
const baseTint = (p) => (p.revealed ? 0x660000 : p.hungry ? 0x3a1010 : null);

// Tags floating over a patient's head, so they read from across the ward: green "healthy" for the cured,
// yellow "suspect" after the reception computer's scan flagged them, red "anomaly" once the X-ray showed it.
const badgeTex = (bg, fg, text) => {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 72;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.beginPath(); g.roundRect(4, 4, 248, 64, 20); g.fill();
  g.fillStyle = fg; g.font = 'bold 36px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 38);
  return new THREE.CanvasTexture(c);
};
const BADGE = { healthy: badgeTex('#1f9d55', '#fff', '✓ Здоровий'), suspect: badgeTex('#ffd166', '#3a2a00', '⚠ Підозра'),
  anomaly: badgeTex('#c0392b', '#fff', '⚠ Аномалія') };
// tex: one of BADGE, or false to hide.
function showBadge(p, tex) {
  if (tex && !p.badge) {
    p.badge = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false }));
    p.badge.scale.set(0.9, 0.25, 1);
    scene.add(p.badge);
  }
  if (!p.badge) return;
  p.badge.visible = !!tex;
  if (tex) { p.badge.material.map = tex; p.badge.material.needsUpdate = true; placeBadge(p); }
}
function placeBadge(p) {
  const top = new THREE.Box3().setFromObject(p.root).max.y;
  p.badge.position.set(p.root.position.x, top + 0.3, p.root.position.z);
}

// Patient + a one-shot timer, for waiting at a bedside.
class Doctor extends Patient {
  after(seconds, fn) { this.timer = { left: seconds, fn }; }
  update(dt) {
    super.update(dt);
    if (this.timer && (this.timer.left -= dt) <= 0) {
      const { fn } = this.timer; this.timer = null; fn();
    }
  }
}

// The doctor starts the shift at the reception desk and sits back down to use the computer there.
function sitDown() {
  doctor.seated = true;
  doctor.root.position.set(CHAIR.x, SIT_Y, CHAIR.z);
  doctor.root.rotation.y = 0; // faces the service window
  doctor.face(0);
  doctor.play('Sit');
  vel.set(0, 0, 0);
}
function standUp() {
  doctor.seated = false;
  doctor.root.position.y = 0;
  doctor.play(DOCTOR.idle);
}

// ---------- doctor (player) ----------
// WASD / arrows move relative to the camera, Shift hurries, E talks to the nearest patient (or uses a ward computer),
// F fires the electroshocker at the nearest patient.
let doctor = null;
const keys = new Set();
// Game keys are swallowed: otherwise the browser treats them as unhandled (macOS beeps on every auto-repeat)
// and a focused slider/button from the HUD would react to them too.
const GAME_KEY = /^(Key[WASDEFP]|Arrow|Shift|Digit|Escape|Space)/;
addEventListener('keydown', (e) => {
  if (!GAME_KEY.test(e.code) || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  if (document.activeElement !== document.body) document.activeElement.blur();
  keys.add(e.code);
  if (e.repeat) return; // holding a key: the first press is enough
  if (!$('confirm').hidden) { if (e.code === 'Escape') closeConfirm(); return; }
  if (!$('over').hidden) { if (e.code === 'Space') nextShift(); return; }
  // Esc closes an open dialogue first; otherwise it (or P) toggles the pause menu.
  if (e.code === 'KeyP' || (e.code === 'Escape' && (paused || !dialog))) return setPaused(!paused);
  if (paused) return;
  if (e.code === 'KeyF') zap(dialog ? dialog.p : target);
  else if (dialog) {
    const n = +e.key;
    if (n >= 1 && n <= dialog.options.length) choose(n - 1);
    else if (e.code === 'Escape') closeDialog();
  } else if (e.code === 'KeyE' && nearby) openDialog(nearby);
});
addEventListener('keyup', (e) => { keys.delete(e.code); if (GAME_KEY.test(e.code)) e.preventDefault(); });
addEventListener('blur', () => { keys.clear(); setPaused(true); }); // switching away pauses the game

// ---------- mouse look ----------
// A click on the scene captures the mouse. Esc gives it back to the browser, which also opens the pause menu.
// Dialogues free the mouse so their buttons can be clicked; closing one, or resuming, captures it again.
function grabMouse() {
  if (!look.wanted || look.locked || paused || dialog) return;
  try { renderer.domElement.requestPointerLock()?.catch?.(() => {}); } catch { /* needs a user gesture; the next click will do */ }
}
function freeMouse() { if (look.locked) document.exitPointerLock(); }
renderer.domElement.addEventListener('click', () => { look.wanted = true; grabMouse(); });
document.addEventListener('pointerlockchange', () => {
  look.locked = document.pointerLockElement === renderer.domElement;
  if (!look.locked && !dialog && !paused) setPaused(true);
});
document.addEventListener('mousemove', (e) => {
  if (!look.locked) return;
  look.yaw -= e.movementX * LOOK_SENS;
  look.pitch = THREE.MathUtils.clamp(look.pitch + e.movementY * LOOK_SENS, ...PITCH);
});
renderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  look.dist = THREE.MathUtils.clamp(look.dist * Math.exp(e.deltaY * 0.001), ...DIST);
}, { passive: false });

// ---------- pause menu ----------
let paused = false;
function setPaused(on) {
  if (!$('over').hidden) return; // the game-over menu is already up
  paused = on;
  keys.clear();
  $('pause').hidden = !on;
  if (on) freeMouse(); else grabMouse();
}
$('resume').onclick = () => setPaused(false);
$('pauseRestart').onclick = askRestart;

// ---------- "really end the game?" ----------
// A child can click restart by accident, so wiping the shift always takes a second, deliberate click.
let wasPaused = false;
function askRestart() {
  wasPaused = paused;
  setPaused(true);
  $('pause').hidden = true;
  $('confirm').hidden = false;
  // The red button wakes up a moment later, so a double-click on "restart" can't land on it.
  $('confirmYes').disabled = true;
  setTimeout(() => { $('confirmYes').disabled = false; }, 700);
}
function closeConfirm() {
  $('confirm').hidden = true;
  setPaused(wasPaused);
}
$('confirmNo').onclick = closeConfirm;
$('confirmYes').onclick = () => { $('confirm').hidden = true; restart(); setPaused(false); };
// Closing or reloading the tab mid-shift gets the browser's own "leave the page?" prompt.
addEventListener('beforeunload', (e) => { if (!over && clockT > 0) e.preventDefault(); });

// ---------- end of shift ----------
// The game never ends: after the report the next shift starts with the same patients still in the hospital.
let over = false;
let shiftAt = 0; // clockT when the current shift began
let shiftNo = 1;
const clockText = (t) => {
  const m = SHIFT_START + Math.floor(Math.min(t - shiftAt, SHIFT_LEN));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
function endShift() {
  over = true;
  freeMouse(); // the menu's buttons need the cursor
  // Whoever is still in the hospital when the shift ends.
  const inside = patients.filter((p) => p.root.visible && !p.dying);
  const untreated = inside.filter((p) => !p.anomaly && !p.healed).length;
  const loose = inside.some((p) => p.anomaly);
  const rows = [
    ['🧑‍⚕️ Прийнято пацієнтів', stats.visits],
    ['✓ Вилікувано', stats.cured],
    ['⚡ Знешкоджено аномалій', `${stats.killed} з ${stats.anomalies}`],
    ['✗ Помилок', stats.mistakes],
    ['☠ З\'їдено пацієнтів', stats.eaten],
    ['🛏 Лишились без лікування', untreated],
  ];
  $('overStats').replaceChildren(...rows.map(([k, v]) => {
    const tr = document.createElement('tr');
    tr.append(Object.assign(document.createElement('td'), { textContent: k }),
      Object.assign(document.createElement('td'), { textContent: v }));
    return tr;
  }));
  $('overLead').textContent = loose ? '⚠ Аномалія досі розгулює лікарнею…'
    : stats.eaten || stats.mistakes ? 'Непогана зміна, але є над чим попрацювати.'
    : 'Бездоганна зміна. Молодець, докторе!';
  log('🌙 Зміну завершено');
  keys.clear();
  paused = true;
  $('pause').hidden = true;
  $('over').hidden = false;
}
function nextShift() {
  shiftAt = clockT;
  shiftNo++;
  Object.keys(stats).forEach((k) => { stats[k] = 0; });
  // An anomaly still loose from the last shift counts towards this one.
  stats.anomalies = patients.filter((p) => p.root.visible && !p.dying && p.anomaly).length;
  showStats();
  over = false;
  $('over').hidden = true;
  paused = false;
  log(`☀ Зміна ${shiftNo} почалась`);
}
$('overContinue').onclick = nextShift;

const vel = new THREE.Vector3();
function updatePlayer(dt) {
  const ix = (keys.has('KeyD') || keys.has('ArrowRight')) - (keys.has('KeyA') || keys.has('ArrowLeft'));
  const iz = (keys.has('KeyW') || keys.has('ArrowUp')) - (keys.has('KeyS') || keys.has('ArrowDown'));
  if (doctor.seated) {
    if (dialog || doctor.busy || !(ix || iz)) return;
    standUp(); // any walking key gets him up from the chair
  }
  const wish = new THREE.Vector3();
  const free = !dialog && !doctor.busy;
  if (free) doctor.face(look.yaw); // he looks where the camera looks, walking or not
  if (free && (ix || iz)) {
    const fwd = new THREE.Vector3(Math.sin(look.yaw), 0, Math.cos(look.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    wish.copy(fwd).multiplyScalar(iz).addScaledVector(right, ix).normalize();
    wish.multiplyScalar((keys.has('ShiftLeft') || keys.has('ShiftRight') ? PLAYER_RUN : PLAYER_WALK)
      * (clockT < coffeeUntil ? COFFEE_BOOST : 1));
  }
  vel.lerp(wish, 1 - Math.exp(-PLAYER_ACCEL * dt));
  if (doctor.busy || (!wish.lengthSq() && vel.lengthSq() < 0.01)) vel.set(0, 0, 0);
  const pos = doctor.root.position;
  const before = pos.clone();
  pos.addScaledVector(vel, dt);
  pushOut(pos, PLAYER_R); pushOut(pos, PLAYER_R);
  pos.x = THREE.MathUtils.clamp(pos.x, -19, 19);
  pos.z = THREE.MathUtils.clamp(pos.z, -19, 19);
  // Keep only the motion that survived collisions: sliding along a wall keeps its speed, walking into it stops.
  if (dt > 0) vel.copy(pos).sub(before).divideScalar(dt);
  const speedNow = vel.length();
  const walk = doctor.actions[DOCTOR.walk];
  // Hysteresis so a brief snag on a prop doesn't flip Walk ↔ Idle and restart the step.
  if (speedNow > 0.15 || (doctor.current === walk && speedNow > 0.05)) {
    // Backing away plays the step in reverse.
    const back = vel.x * Math.sin(doctor.root.rotation.y) + vel.z * Math.cos(doctor.root.rotation.y) < -0.1;
    walk.timeScale = (back ? -1 : 1) * Math.max(speedNow, PLAYER_WALK * 0.5) / DOCTOR.walkSpeed;
    doctor.play(DOCTOR.walk, 0.15);
  } else if (doctor.current === walk) doctor.play(DOCTOR.idle, 0.2);
}

// ---------- dialogue ----------
// Potential patients (arriving, queueing, waiting in the lobby) and admitted ones (in a ward bed) get different talks.
let dialog = null;  // { p, options }
let nearby = null;  // patient or ward computer within reach
let target = null;  // nearest patient, for the electroshocker
const bye = { label: 'Бувайте!', end: true };
const close = { label: 'Закрити', end: true };

function nodesFor(p) {
  const c = p.cfg;
  const vars = {
    prey: patients.find((q) => q !== p && q.inBed && !q.anomaly && q.ward !== p.ward)?.cfg.name,
    tools: c.illness.steps.map(([t]) => TOOL_NAMES[t]).join(', '),
  };
  // An anomaly talks from the line bank; normal patients (and gaps in the bank) keep the character's own lines.
  const say = (situation, fallback) => (p.archetype && pickLine(LINES, c.id, p.archetype, situation, vars)) || fallback;
  if (p.leaving) return { start: { text: 'Дякую, докторе! Іду додому здоровим.', options: [bye] } };
  if (p.orTrip === 'going') return { start: { text: 'Іду в операційну… Трішки страшно, але я сміливий.', options: [bye] } };
  if (p.orTrip === 'back') return { start: { text: 'Іду до своєї палати трохи відпочити. Дякую, докторе!', options: [bye] } };
  if (p.orTrip === 'table') {
    const apply = heldTool() && !p.healed ? [{ label: `Застосувати: ${TOOL_NAMES[held]}`, operate: true }] : [];
    return { start: { text: p.healed ? 'Я вже здоровий! Зараз піду до палати відпочивати.'
      : p.opStep ? 'Хр-р-р… (пацієнт солодко спить)'
      : `Трішки страшно… Але я вам довіряю, докторе.${held ? '' : ' (Інструменти — в хірургічній шафці.)'}`,
    options: [...apply, bye] } };
  }
  if (p.hunting && !p.inBed) return { start: { text: 'Не заважайте, лікарю. Я просто… йду в гості.', options: [bye] } };
  if (p.inBed) {
    // A glutton goes hunting untreated, so it must not thank the doctor or call itself healthy.
    if (p.revealed) return { start: { text: p.healed ? 'Смачно було… Дякую за лікування, лікарю.' : 'Смачно було… Тепер можна й полежати.', options: [bye] } };
    if (p.hunting) return { start: { text: p.healed ? 'Я вже здоровий. Тільки дуже… голодний.' : 'Я такий голодний, що аж лежати не можу…', options: [bye] } };
    const examine = { label: 'Дозвольте вас оглянути.', examine: true };
    const treat = heldTool() ? [{ label: `Застосувати: ${TOOL_NAMES[held]}`, apply: true }] : [];
    const surgery = p.severe && p.analysis === 'normal' && !p.healed;
    const act = p.healed ? [] : p.examined ? [...(surgery ? [{ label: 'Ходімо в операційну', toOR: true }] : []), ...treat] : [examine];
    return {
      start: { text: say(p.hungry ? 'hungry' : 'inBed', c.inBed), options: [{ label: 'Як ви себе почуваєте?', next: 'feel' }, ...act, bye] },
      // A gaslighter "knows" its treatment and talks the doctor out of taking the sample to the lab.
      feel: { text: (!p.healed && !p.analysis && say('advice', null)) || (p.healed ? 'Після лікування вже набагато краще!'
        : surgery ? 'Комп\'ютер каже, що мені потрібна операція… Ви ж будете поруч?'
        : p.step ? `Вже краще, але лікування ще не закінчене (${p.step} з ${c.illness.steps.length}).`
        : p.examined ? 'Що зі мною, покаже комп\'ютер, коли зразок побуває в лабораторії. А інструменти — он у шафці.'
        : 'Та нормально… Але ви ж мене ще не оглядали.'),
        options: [...act, bye] },
      done: { text: 'Огляд завершено, зразок у вас у руках. Віднесіть його в лабораторію — результат з\'явиться на комп\'ютері в палаті.',
        options: [...treat, bye] },
    };
  }
  const where = p.ward ? `Мене вже записали ${p.ward.to}!`
    : p.seat ? (p.skip ? 'Лікар сказав почекати, чекаю тут.' : !rooms.some((r) => !r.taken && mayUse(p, r)) ? 'Вільних палат немає, чекаю тут.'
      : p.xray && doctor?.seated ? 'Знімок зробили, чекаю на направлення до палати.'
      : 'Лікаря немає на місці, чекаю тут.') : 'Стою в черзі до реєстратури.';
  return {
    start: { text: p.atXray ? 'Стою біля рентгена, чекаю на знімок.' : say('hello', c.hello), options: [
      { label: 'Що вас турбує?', next: 'complaint' },
      { label: 'Ви вже зареєструвались?', next: 'where' },
      bye] },
    complaint: { text: say('complaint', c.complaint), options: [
      { label: 'Не хвилюйтесь, ми допоможемо.', next: 'calm' }, bye] },
    calm: { text: 'Дякую, докторе!', options: [bye] },
    where: { text: where, options: [{ label: 'Що вас турбує?', next: 'complaint' }, bye] },
  };
}

function show(node) {
  freeMouse();
  dialog.options = node.options;
  $('dlgText').textContent = node.text;
  $('dlgOptions').replaceChildren(...node.options.map((o, i) => {
    const b = document.createElement('button');
    const key = document.createElement('span');
    key.className = 'key';
    key.textContent = i + 1;
    b.append(key, o.label);
    b.onclick = () => choose(i);
    return b;
  }));
}

function computerNode(pc) {
  const p = inWard(pc.ward);
  if (!p) return { text: 'Палата вільна.', options: [bye] };
  const who = `Пацієнт: ${p.cfg.name}.`;
  if (!p.examined) return { text: p.sabotaged ? `${who} ⚠ Помилка сенсора: зразок пошкоджено. Потрібен повторний огляд.`
    : `${who} ЧЕКАЮ ЗРАЗОК: огляньте пацієнта й віднесіть зразок у лабораторію.`, options: [bye] };
  if (!p.analysis || p.analysis === 'running' || p.analysis === 'queued') {
    return { text: `${who} ЗРАЗОК У ЛАБІ. ${heldSample() === p ? 'Зразок у вас у руках: покладіть його в аналізатор у лабораторії.'
      : 'Аналіз триває, результат з\'явиться тут.'}`, options: [bye] };
  }
  if (p.analysis === 'anomaly') {
    return { text: `${who} ⚠ АНОМАЛІЯ! Не лікуйте: знешкодьте електрошокером (F).`, options: [bye] };
  }
  const { name, steps } = p.cfg.illness;
  if (p.severe) {
    const plan = SURGERY.map(([, label, what], i) => `${i < p.opStep ? '✓' : `${i + 1}.`} ${label}: ${what}`).join('\n');
    if (p.healed) return { text: `${who} ✓ ЗДОРОВИЙ. Операцію завершено:\n${plan}`, options: [bye] };
    return { text: `${who} Важкий випадок: потрібна операція. Діагноз: ${name}.\nІнструменти з палатної шафки не допоможуть. `
      + `Поговоріть з пацієнтом і відведіть його в операційну; інструменти — в хірургічній шафці, по черзі:\n${plan}`, options: [bye] };
  }
  const plan = steps.map(([tool, what], i) => `${i < p.step ? '✓' : `${i + 1}.`} ${TOOL_NAMES[tool]}: ${what}`).join('\n');
  if (p.healed) return { text: `${who} ✓ ЗДОРОВИЙ. Лікування завершено:\n${plan}`, options: [bye] };
  return { text: `${who} Норма, не аномалія. Діагноз: ${name}.\nЛікування (інструменти в шафці, по черзі):\n${plan}`,
    options: [bye] };
}

// Reception computer: lists everyone in the hospital and scans them for anomalies. The scan is a hint, not a verdict:
// it is right SCAN_HIT of the time; only the lab analysis and the X-ray are certain.
function whereIs(p) {
  if (p.orTrip) return p.orTrip === 'table' ? 'операційна' : p.orTrip === 'going' ? 'іде в операційну' : `іде ${p.ward.to}`;
  if (p.inBed) return p.ward.label;
  if (p.atXray) return 'біля рентгена';
  if (queue.includes(p)) return 'черга до віконця';
  if (p.seat) return 'вестибюль';
  if (p.leaving) return 'іде додому';
  return p.ward ? `іде ${p.ward.to}` : 'коридор';
}
const scanText = (p) => (p.analysis === 'anomaly' ? '⚠ АНОМАЛІЯ (підтверджено аналізом)'
  : p.xray === 'anomaly' ? '⚠ АНОМАЛІЯ (рентген)' : p.xray === 'clear' ? '✓ рентген: норма'
  : p.scan === 'running' ? 'сканую…' : p.scan === 'suspect' ? '⚠ підозра на аномалію'
  : p.scan === 'clear' ? '✓ ознак аномалії немає' : 'не скановано');
const inHospital = () => patients.filter((p) => p.root.visible && !p.dying);

// The patient standing at the service window, if any: the one the referral options are for.
const atWindow = () => (queue[0] && !queue[0].path.length ? queue[0] : null);
// The reception computer's first screen: referral of the patient at the window. The free ordinary wards are listed
// right here when everything fits in keys 1–9; otherwise they sit behind one option "Направити до палати…".
// The scanner is always its own screen.
function rcNode() {
  const front = atWindow();
  const free = front ? rooms.filter((r) => !r.taken && mayUse(front, r)) : [];
  const to = (r) => ({ label: `Направити ${r.to}`, refer: r.key, p: front });
  const wardsFree = free.filter((r) => r.kind === 'ward'), others = free.filter((r) => r.kind !== 'ward').map(to);
  const tail = [{ label: '🔎 Сканер аномалій', scanner: true }, close];
  const wait = front ? [{ label: 'Хай зачекає у вестибюлі', refer: 'lobby', p: front }] : [];
  const fits = wardsFree.length + others.length + wait.length + tail.length <= 9;
  const wardOpts = fits ? wardsFree.map(to) : [{ label: 'Направити до палати…', wardList: true }];
  return {
    text: front ? `Біля віконця: ${front.cfg.name}` : 'Біля віконця нікого.',
    options: [...(wardsFree.length ? wardOpts : []), ...others, ...wait, ...tail],
  };
}
// Sub-screen: the free ordinary wards (6 at most). Falls back to the first screen once there is nothing to pick.
function wardListNode() {
  const front = atWindow(), free = rooms.filter((r) => r.kind === 'ward' && !r.taken);
  if (!front || !free.length) { dialog.wardList = false; return rcNode(); }
  return {
    text: `Біля віконця: ${front.cfg.name}. До якої палати?`,
    options: [...free.map((r) => ({ label: `Направити ${r.to}`, refer: r.key, p: front })), { label: '← Назад', back: true }],
  };
}
function scannerNode() {
  const list = inHospital();
  const rows = list.map((p) => `• ${p.cfg.name} — ${whereIs(p)}: ${scanText(p)}`).join('\n');
  return {
    text: `Сканер аномалій (точність ${Math.round(SCAN_HIT * 100)}%, остаточно — аналіз у лабораторії або рентген).\n`
      + (rows || 'У лікарні зараз нікого.'),
    options: [...list.filter((p) => !p.scan && !p.xray && p.analysis !== 'anomaly').map((p) => ({ label: `Сканувати: ${p.cfg.name}`, scan: p })),
      { label: '← Назад', back: true }],
  };
}
// Redraw whichever reception screen is open.
const rcRefresh = () => show(dialog.scanner ? scannerNode() : dialog.wardList ? wardListNode() : rcNode());
function drawRcScreen() {
  const { g, tex } = rcScreen, last = rcScreen.last;
  g.fillStyle = '#1d2330'; g.fillRect(0, 0, 256, 160);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#7cc4a8'; g.font = 'bold 24px system-ui'; g.fillText('СКАНЕР АНОМАЛІЙ', 128, 40);
  g.fillStyle = last?.scan === 'suspect' ? '#ffd166' : '#fff'; g.font = '20px system-ui';
  g.fillText(last ? `${last.cfg.name}: ${last.scan === 'suspect' ? 'підозра' : last.scan === 'clear' ? 'норма' : '…'}` : 'готовий', 128, 105);
  tex.needsUpdate = true;
}
function scan(p) {
  p.scan = 'running';
  rcScreen.last = p;
  drawRcScreen();
  tween(SCAN_TIME, null, () => {
    if (p.scan !== 'running') return; // left the hospital meanwhile
    const hit = Math.random() < SCAN_HIT;
    p.scan = p.anomaly === hit ? 'suspect' : 'clear';
    if (p.scan === 'suspect' && !p.healed) showBadge(p, BADGE.suspect);
    log(`Сканер: ${p.cfg.name} — ${p.scan === 'suspect' ? 'підозра на аномалію' : 'норма'}`);
    drawRcScreen();
    if (dialog?.rc) rcRefresh();
  });
}

function openStaffSpot(spot) {
  dialog = { [spot.kind]: spot, options: [] };
  if (spot.kind === 'rc') {
    if (!doctor.seated) sitDown();
    $('dlgName').textContent = 'Комп\'ютер приймальні';
  } else {
    doctor.face(Math.atan2(spot.pos.x - doctor.root.position.x, spot.pos.z - 0.6 - doctor.root.position.z));
    $('dlgName').textContent = spot.kind === 'coffee' ? 'Кавомашина' : 'Шоколадка';
  }
  $('dialog').hidden = false;
  show(spot.kind === 'rc' ? rcNode()
    : spot.kind === 'coffee' ? { text: clockT < coffeeUntil ? `Ви ще бадьорий, до ${clockText(coffeeUntil)}. Друга чашка почекає.`
      : 'Чашка кави — і годину ходите швидше.', options: [...(clockT < coffeeUntil ? [] : [{ label: '☕ Зварити каву', coffee: true }]), close] }
    : { text: 'Шоколадка «Совеня». Ваша улюблена.', options: [{ label: '🍫 З\'їсти', choco: true }, { label: 'Залишити на потім', end: true }] });
}
// Short break at the coffee machine / chocolate: the doctor is busy for a moment, then the reply shows.
function treat(anim, dur, text, done) {
  $('dlgText').textContent = '…';
  $('dlgOptions').replaceChildren();
  dialog.options = [];
  doctor.busy = true;
  doctor.play(anim);
  doctor.after(dur, () => {
    doctor.busy = false;
    doctor.play(DOCTOR.idle);
    done();
    if (dialog) show({ text, options: [close] });
  });
}
let coffeeUntil = 0;

// One thing in the hands at a time: a tool key from the cabinet (applying it uses it up, right or wrong),
// or { sample: p }, the sample tube from p's examination, until it goes into the lab analyzer.
let held = null;
const heldTool = () => (typeof held === 'string' ? held : null);
const heldSample = () => held?.sample ?? null;
const heldText = () => (heldTool() ? TOOL_NAMES[held] : `🧪 Зразок: ${held.sample.cfg.name}`);
const showHeld = () => { $('held').textContent = held ? `У руках: ${heldText()}` : 'Руки вільні'; };

function openCabinet(cab) {
  dialog = { cab, options: [] };
  doctor.face(Math.atan2(cab.pos.x - doctor.root.position.x, cab.pos.z - 0.6 - doctor.root.position.z));
  $('dlgName').textContent = `Шафка з інструментами · ${cab.ward.label}`;
  $('dialog').hidden = false;
  if (heldSample()) return show({ text: `У руках: ${heldText()}. Спершу віднесіть зразок у лабораторію.`, options: [close] });
  show({ text: held ? `У руках: ${TOOL_NAMES[held]}. Взяти інше?` : 'Що взяти?',
    options: [...Object.entries(TOOLS).map(([take, label]) => ({ label, take })),
      ...(TOOLS[held] ? [{ label: `Покласти назад: ${TOOL_NAMES[held]}`, putBack: true }] : []), close] });
}
// The operating room's cabinet: only the surgical tools.
function openOrCabinet(cab) {
  dialog = { orCab: cab, options: [] };
  doctor.face(Math.atan2(cab.pos.x - doctor.root.position.x, cab.pos.z - 0.6 - doctor.root.position.z));
  $('dlgName').textContent = 'Хірургічна шафка · операційна';
  $('dialog').hidden = false;
  if (heldSample()) return show({ text: `У руках: ${heldText()}. Спершу віднесіть зразок у лабораторію.`, options: [close] });
  const mine = SURGERY.some(([k]) => k === held);
  show({ text: `${held ? `У руках: ${TOOL_NAMES[held]}. Взяти інше?` : 'Що взяти?'} Операція — по черзі: ${surgeryOrder}.`,
    options: [...SURGERY.map(([take, label]) => ({ label, take })),
      ...(mine ? [{ label: `Покласти назад: ${TOOL_NAMES[held]}`, putBack: true }] : []), close] });
}

function openComputer(pc) {
  dialog = { pc, options: [] };
  doctor.face(Math.atan2(pc.pos.x - doctor.root.position.x, pc.pos.z - 0.6 - doctor.root.position.z));
  $('dlgName').textContent = `Комп'ютер · ${pc.ward.label}`;
  $('dialog').hidden = false;
  show(computerNode(pc));
}

// Bedside examination: the doctor is busy a few seconds, then holds the patient's sample. The hands must be free.
// A flatterer pleads at that moment, trying to talk him out of taking the sample to the lab.
// Returns false when it can't start. __game.examine calls this too.
function examine(p) {
  if (!p.inBed || p.examined || p.healed || held || doctor.busy) return false;
  doctor.busy = true;
  doctor.play('Examine');
  doctor.after(3, () => {
    doctor.play('Verdict_Clear');
    doctor.after(1.5, () => { doctor.busy = false; doctor.play(DOCTOR.idle); });
    if (!p.inBed || !p.root.visible || p.dying) return; // gone meanwhile
    p.examined = true;
    held = { sample: p };
    showHeld();
    drawScreens();
    const plea = p.archetype === 'flatterer' && pickLine(LINES, p.cfg.id, 'flatterer', 'distract');
    log(plea ? `${p.cfg.name}: «${plea}»` : `Зразок узято: ${p.cfg.name}`);
    if (dialog?.p === p) show(dialog.nodes.done);
  });
  return true;
}

// Lab analyzer: takes the sample in the doctor's hands; samples are analysed one after another, ANALYSIS_TIME each.
// The result goes where the ward computer shows it (p.analysis).
function labNode() {
  const [p, ...waiting] = lab.queue, s = heldSample();
  const text = [
    p ? `Аналіз: ${p.cfg.name}…` : lab.last ? `Останній аналіз: ${lab.last.cfg.name} — ${lab.last.analysis === 'anomaly' ? '⚠ АНОМАЛІЯ'
      : lab.last.severe ? 'важкий випадок: потрібна операція' : '✓ норма'}.` : 'Аналізатор вільний.',
    waiting.length ? `У черзі: ${waiting.map((q) => q.cfg.name).join(', ')}.` : '',
    s ? `У руках: ${heldText()}.` : 'Зразок з\'являється в руках після огляду пацієнта в палаті.',
  ].filter(Boolean).join('\n');
  return { text, options: [...(s ? [{ label: `Покласти зразок: ${s.cfg.name}`, labPut: s }] : []), close] };
}
function openLab(spot) {
  dialog = { lab: spot, options: [] };
  doctor.face(Math.atan2(spot.pos.x - doctor.root.position.x, spot.pos.z - 0.6 - doctor.root.position.z));
  $('dlgName').textContent = 'Лабораторія · аналізатор';
  $('dialog').hidden = false;
  show(labNode());
}
// Puts p's sample from the doctor's hands into the analyzer; false if he isn't holding it. __game.labAnalyze calls this too.
function labAnalyze(p) {
  if (!p || heldSample() !== p) return false;
  held = null;
  showHeld();
  p.analysis = 'queued';
  lab.queue.push(p);
  log(`Зразок у лабораторії: ${p.cfg.name}`);
  if (lab.queue.length === 1) runLab();
  else drawLab();
  drawScreens();
  return true;
}
function runLab() {
  const p = lab.queue[0], run = lab.run = {};
  lab.progress = 0;
  drawLab();
  if (!p) return;
  p.analysis = 'running';
  tween(ANALYSIS_TIME, (k) => { if (lab.run === run) { lab.progress = k; drawLab(); } }, () => {
    if (lab.run !== run) return; // the sample was spoiled or its patient left; dropSample started the next one
    lab.queue.shift();
    p.analysis = p.anomaly ? 'anomaly' : 'normal';
    lab.last = p;
    log(`Аналіз готовий: ${p.cfg.name} — ${p.anomaly ? 'АНОМАЛІЯ' : p.severe ? `${p.cfg.illness.name}. Важкий випадок: потрібна операція` : 'норма'}`);
    runLab();
    drawScreens();
    if (dialog?.pc?.ward === p.ward) show(computerNode(dialog.pc));
    if (dialog?.lab) show(labNode());
  });
}
// p's sample is gone (spoiled, or the patient left): out of the hands or the analyzer, the analysis forgotten.
function dropSample(p) {
  if (heldSample() === p) { held = null; showHeld(); }
  const i = lab.queue.indexOf(p);
  if (i >= 0) {
    lab.queue.splice(i, 1);
    if (i === 0) runLab(); else drawLab();
  }
  if (lab.last === p) { lab.last = null; drawLab(); }
  if (p.analysis === 'running' || p.analysis === 'queued') p.analysis = null;
  if (dialog?.lab) show(labNode());
}

// X-ray console: one option, the shot of whoever stands at the screen. XRAY_TIME seconds later the viewer shows the
// skeleton (always right), and the patient goes to sit in the lobby until the doctor refers it to a ward.
const XRAY_TIME = 3;
function xrayNode() {
  const p = patients.find((q) => q.ward === xray && q.root.visible && !q.dying);
  const last = xray.shot?.result !== 'running' && xray.shot;
  const result = last ? `Останній знімок: ${last.p.cfg.name} — ${last.result === 'anomaly' ? '⚠ АНОМАЛІЯ! Не лікуйте: знешкодьте електрошокером (F).' : '✓ норма, не аномалія.'}` : '';
  if (xray.shot?.result === 'running') return { text: `Знімок: ${xray.shot.p.cfg.name}…`, options: [close] };
  if (p?.atXray) return { text: [result, `Біля екрана: ${p.cfg.name}.`].filter(Boolean).join('\n'),
    options: [{ label: `Зробити знімок: ${p.cfg.name}`, shoot: p }, close] };
  return { text: [result, p ? `${p.cfg.name} ще йде на рентген.` : 'Біля рентгена нікого немає.'].filter(Boolean).join('\n'), options: [close] };
}
function openXray(spot) {
  dialog = { xray: spot, options: [] };
  doctor.face(Math.atan2(spot.pos.x - doctor.root.position.x, spot.pos.z - 0.6 - doctor.root.position.z));
  $('dlgName').textContent = 'Рентген · пульт';
  $('dialog').hidden = false;
  show(xrayNode());
}
// Takes the picture of p standing at the screen; false if it isn't there. __game.xrayShot calls this too.
function xrayShot(p) {
  if (!p?.atXray || xray.shot?.result === 'running') return false;
  xray.shot = { p, result: 'running' };
  drawXray();
  tween(XRAY_TIME, null, () => {
    if (!p.atXray || p.dying) { if (xray.shot?.p === p) xray.shot = null; drawXray(); if (dialog?.xray) show(xrayNode()); return; } // gone meanwhile
    p.xray = p.anomaly ? 'anomaly' : 'clear';
    xray.shot = { p, result: p.xray };
    if (p.anomaly) showBadge(p, BADGE.anomaly);
    else if (p.badge?.material.map === BADGE.suspect) showBadge(p, false); // the scan's hint was wrong
    log(`Рентген: ${p.cfg.name} — ${p.anomaly ? 'АНОМАЛІЯ' : 'норма'}`);
    p.atXray = false;
    xray.taken = false;
    p.ward = null;
    const spot = chairSpots.find((s) => !s.taken); // there are more chairs than patients can be inside
    spot.taken = true;
    p.seat = spot;
    p.walkTo([...wardToLobby(xray), v3(0, spot.pos.z), spot.pos], () => p.face(spot.facing));
    drawXray();
    if (dialog?.xray) show(xrayNode());
  });
  return true;
}

function openDialog(p) {
  if (!(p instanceof Patient)) {
    return p.kind === 'cab' ? openCabinet(p) : p.kind === 'orCab' ? openOrCabinet(p) : p.kind === 'pc' ? openComputer(p) : p.kind === 'xray' ? openXray(p)
      : p.kind === 'lab' ? openLab(p) : openStaffSpot(p);
  }
  dialog = { p, nodes: nodesFor(p), options: [] };
  p.talking = true;
  if (!p.inBed && p.orTrip !== 'table') { p.play(p.cfg.idle); p.face(Math.atan2(doctor.root.position.x - p.root.position.x, doctor.root.position.z - p.root.position.z)); }
  doctor.face(Math.atan2(p.root.position.x - doctor.root.position.x, p.root.position.z - doctor.root.position.z));
  $('dlgName').textContent = p.cfg.name + (p.inBed ? ` · ${p.ward.label}` : p.orTrip === 'table' ? ' · операційна' : ' · відвідувач');
  $('dialog').hidden = false;
  show(dialog.nodes.start);
}

function choose(i) {
  const o = dialog.options[i];
  if (o.end) return closeDialog();
  if (o.labPut) { labAnalyze(o.labPut); return show(labNode()); }
  if (o.scan) { scan(o.scan); return show(scannerNode()); }
  if (o.shoot) { xrayShot(o.shoot); return show(xrayNode()); }
  if (o.scanner || o.wardList || o.back) { dialog.scanner = !!o.scanner; dialog.wardList = !!o.wardList; return rcRefresh(); }
  if (o.refer) { refer(o.p, o.refer); dialog.wardList = false; return show(rcNode()); }
  if (o.coffee) {
    return treat('Examine', 2, 'Ааах, кава! Пір\'я дибки. Годину ходитиму швидше.', () => {
      coffeeUntil = clockT + COFFEE_LEN;
      log(`☕ Бадьорість до ${clockText(coffeeUntil)}`);
    });
  }
  if (o.choco) {
    return treat('Verdict_Clear', 1.5, 'Ммм… Смакота. Тепер можна й до пацієнтів.', () => {
      choco.visible = false;
      log('🍫 Шоколадку з\'їдено');
    });
  }
  if (o.take) { held = o.take; showHeld(); log(`Взято: ${TOOL_NAMES[held]}`); return closeDialog(); }
  if (o.putBack) { log(`Покладено назад: ${TOOL_NAMES[held]}`); held = null; showHeld(); return closeDialog(); }
  if (o.apply) return applyTool(dialog.p);
  if (o.operate) return operate(dialog.p);
  if (o.toOR) {
    const p = dialog.p;
    return show(toOR(p) ? { text: 'Добре, докторе… Тільки тримайте мене за лапку.', options: [bye] }
      : { text: orRoom.taken ? 'Операційна зараз зайнята. Я полежу тут, поки вона звільниться.' : 'Зараз не можу…', options: [bye] });
  }
  if (o.examine) {
    // Hands full: the tool goes back to the cabinet (or gets used) first; a sample goes to the lab first.
    if (held) {
      return show({ text: heldTool() ? `Руки зайняті: ${TOOL_NAMES[held]}. Спершу покладіть його назад у шафку або застосуйте.`
        : `Руки зайняті: ${heldText()}. Спершу віднесіть зразок у лабораторію.`, options: [bye] });
    }
    if (!examine(dialog.p)) return;
    $('dlgText').textContent = '…';
    $('dlgOptions').replaceChildren();
    dialog.options = [];
    return;
  }
  show(dialog.nodes[o.next]);
}

function applyTool(p) {
  // A severe case: the ward tools don't help. The patient says so, the tool stays in the hands, not a mistake.
  if (p.severe && !p.healed) {
    return show({ text: p.analysis === 'normal' ? 'Дякую, докторе, але це не допоможе. Комп\'ютер каже, мені потрібна операція.'
      : 'Дякую, докторе, але щось не допомагає… Може, спершу подивимось, що покаже аналіз?', options: [bye] });
  }
  const tool = held, steps = p.cfg.illness.steps, [need, , reply] = steps[p.step];
  held = null;
  showHeld();
  $('dlgText').textContent = '…';
  $('dlgOptions').replaceChildren();
  dialog.options = [];
  doctor.busy = true;
  doctor.play('Examine');
  doctor.after(1.5, () => {
    doctor.busy = false;
    doctor.play(DOCTOR.idle);
    let text = reply;
    if (tool !== need) {
      stats.mistakes++;
      showStats();
      text = `Ой! ${TOOL_NAMES[tool]} — це точно не з мого лікування.`;
      log(`✗ ${p.cfg.name}: не той інструмент`);
    } else if (++p.step === steps.length) {
      p.healed = true;
      // Treating an anomaly sets it loose: it gets up and goes after a patient in another ward.
      if (p.anomaly) { p.hunting = true; text = 'Дякую, докторе… Ой. У мене з\'явився такий апетит.'; }
      else {
        text = `${reply} Дякую, докторе, я здоровий!`;
        cure(p);
      }
    }
    drawScreens();
    if (dialog?.p === p) show({ text, options: [bye] });
  });
}

// A normal patient is healthy now: counted, a green flash and badge, and it rests DISCHARGE_AFTER before going home.
function cure(p) {
  p.healed = true;
  log(`✓ ${p.cfg.name} вилікуваний`);
  stats.cured++;
  showStats();
  p.dischargeAt = clockT + DISCHARGE_AFTER;
  showBadge(p, BADGE.healthy);
  tint(p, 0x1f9d55);
  tween(1, null, () => tint(p, baseTint(p)));
}

// ---------- operating room ----------
// Walking route between two rooms: along the wing's corridor, or through the lobby to the other wing.
const between = (a, b) => (a.side === b.side ? [...wardToLobby(a).slice(0, 2), ...wardToLobby(b).slice(0, 2).reverse()]
  : [...wardToLobby(a), ...wardToLobby(b).reverse()]);
// "Ходімо в операційну": a severe case with its analysis in gets up from its bed and walks to the operating table.
// Its ward stays its own. False when it can't: not such a case, or the OR is taken. __game.toOR calls this too.
function toOR(p) {
  if (!p?.inBed || !p.severe || p.healed || p.analysis !== 'normal' || orRoom.taken) return false;
  const w = p.ward;
  orRoom.taken = true;
  p.inBed = false;
  p.orTrip = 'going';
  p.root.position.copy(bedside(w));
  p.root.rotation.set(0, -w.side * Math.PI / 2, 0);
  p.targetYaw = -w.side * Math.PI / 2;
  p.walkTo([...between(w, orRoom), orRoom.bedside], () => {
    p.orTrip = 'table';
    p.root.position.set(orRoom.table.x, 0.72, orRoom.table.z + 0.75);
    p.root.rotation.set(-Math.PI / 2, 0, 0);
    p.targetYaw = 0;
    drawOR();
    log(`${p.cfg.name} лежить на операційному столі`);
  });
  if (p.talking) p.play(p.cfg.idle); // waits for the dialog to close
  drawScreens();
  log(`${p.cfg.name} іде в операційну`);
  return true;
}
// Applies the surgical tool in the hands to the patient on the table. Right one: the next stage; wrong: a mistake,
// the operation stays where it was. The tool is used up either way, like on a ward.
function operate(p) {
  const tool = held, [need, , , reply] = SURGERY[p.opStep];
  held = null;
  showHeld();
  $('dlgText').textContent = '…';
  $('dlgOptions').replaceChildren();
  dialog.options = [];
  doctor.busy = true;
  doctor.play('Examine');
  doctor.after(1.5, () => {
    doctor.busy = false;
    doctor.play(DOCTOR.idle);
    if (p.orTrip !== 'table') return; // gone meanwhile
    let text = reply;
    if (tool !== need) {
      stats.mistakes++;
      showStats();
      text = `Ой! ${TOOL_NAMES[tool]} — не зараз. Операція йде по черзі: ${surgeryOrder}.`;
      log(`✗ ${p.cfg.name}: не той хірургічний інструмент`);
    } else if (++p.opStep === SURGERY.length) {
      text = `${reply} …Ой, я вже прокинувся? Все? Дякую, докторе, я здоровий!`;
      cure(p);
      backToWard(p);
    }
    drawScreens();
    drawOR();
    if (dialog?.p === p) show({ text, options: [bye] });
  });
}
// Operated: gets off the table (the OR is free again) and walks back to its ward bed to rest, then goes home as usual.
function backToWard(p) {
  const w = p.ward;
  orRoom.taken = false;
  p.orTrip = 'back';
  p.root.position.copy(orRoom.bedside);
  p.root.rotation.set(0, -orRoom.side * Math.PI / 2, 0);
  p.targetYaw = -orRoom.side * Math.PI / 2;
  p.walkTo([...between(orRoom, w), bedside(w)], () => {
    p.orTrip = null;
    lieDown(p, w);
    p.dischargeAt = clockT + DISCHARGE_AFTER; // the rest starts once it is back in bed
    log(`${p.cfg.name} відпочиває ${w.at}`);
  });
  if (p.talking) p.play(p.cfg.idle);
}

function closeDialog() {
  if (!dialog || doctor.busy) return;
  const { p } = dialog;
  if (p) {
    p.talking = false;
    if (p.path.length) p.play(p.cfg.walk);
  }
  dialog = null;
  $('dialog').hidden = true;
  grabMouse();
}

function updateNearby() {
  nearby = target = null;
  if (!doctor || dialog) { $('talkHint').hidden = true; return; }
  const dist = (pos) => Math.hypot(pos.x - doctor.root.position.x, pos.z - doctor.root.position.z);
  let best = TALK_DIST;
  for (const p of patients) {
    if (!p.root.visible || p.dying) continue;
    const d = dist(p.root.position);
    if (d < best) { best = d; target = p; }
  }
  nearby = target;
  const spots = [...wards.flatMap((w) => [w.pc, w.cab]), xray.console, lab.analyzer, orRoom.cab, staffSpots.rc, staffSpots.coffee];
  if (choco.visible) spots.push(staffSpots.choco);
  for (const spot of spots) {
    const d = dist(spot.pos);
    if (d < PC_DIST && d < best) { best = d; nearby = spot; }
  }
  $('talkHint').hidden = !nearby;
  if (!nearby) return;
  const zapHint = target ? ` · F — електрошокер: ${target.cfg.name}` : '';
  const seatHint = doctor.seated ? ' · WASD — встати' : '';
  $('talkHint').textContent = nearby === target ? `E — поговорити: ${target.cfg.name}${zapHint}`
    : nearby.kind === 'cab' ? `E — шафка з інструментами${zapHint}`
    : nearby.kind === 'orCab' ? `E — хірургічна шафка${zapHint}`
    : nearby.kind === 'pc' ? `E — комп'ютер ${nearby.ward.of}${zapHint}`
    : nearby.kind === 'xray' ? `E — рентген${zapHint}`
    : nearby.kind === 'lab' ? `E — лабораторія${zapHint}`
    : nearby.kind === 'rc' ? `E — комп'ютер приймальні: направлення й сканер${seatHint}`
    : nearby.kind === 'coffee' ? 'E — кавомашина' : 'E — шоколадка';
}

// ---------- electroshocker ----------
const stats = { visits: 0, cured: 0, anomalies: 0, killed: 0, mistakes: 0, eaten: 0 };
const showStats = () => {
  $('stats').textContent = `✓ Вилікувано: ${stats.cured} · ⚡ Знищено аномалій: ${stats.killed}`
    + ` · ✗ Помилок: ${stats.mistakes} · ☠ З'їдено: ${stats.eaten}`;
};
const bolt = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x9fe8ff }));
bolt.visible = false;
scene.add(bolt);

// Jagged line from the doctor's hand to the target's middle, re-jagged every frame while it's visible.
function lightning(p) {
  const from = doctor.root.position.clone().add(new THREE.Vector3(0, 0.6, 0));
  const to = new THREE.Box3().setFromObject(p.root).getCenter(new THREE.Vector3());
  tween(0.35, () => {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const v = from.clone().lerp(to, i / 8);
      if (i > 0 && i < 8) v.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.18));
      pts.push(v);
    }
    bolt.geometry.setFromPoints(pts);
    bolt.visible = true;
  }, () => { bolt.visible = false; });
  tint(p, 0x3399ff);
  tween(0.35, null, () => tint(p, baseTint(p)));
}

function zap(p) {
  if (!doctor || !p || p.dying || doctor.busy || doctor.seated) return;
  if (dialog) closeDialog();
  doctor.face(Math.atan2(p.root.position.x - doctor.root.position.x, p.root.position.z - doctor.root.position.z));
  doctor.busy = true;
  doctor.play('Verdict_Anomaly');
  doctor.after(0.8, () => { doctor.busy = false; doctor.play(DOCTOR.idle); });
  lightning(p);
  if (!p.anomaly) {
    stats.mistakes++;
    showStats();
    log(`⚡ Ай! ${p.cfg.name} — звичайний пацієнт. Помилка!`);
    return;
  }
  p.dying = true;
  p.path = [];
  stats.killed++;
  showStats();
  log(`⚡ Аномалію знищено: ${p.cfg.name} (${ARCHETYPES[p.archetype]})`);
  const s0 = p.root.scale.x;
  tween(0.7, (k) => p.root.scale.setScalar(s0 * (1 - k)), () => removePatient(p));
}

// Takes a patient out of the game: frees its bed/chair/queue place and closes a dialog with it.
function removePatient(p) {
  if (dialog?.p === p) { dialog = null; $('dialog').hidden = true; }
  p.root.visible = false;
  showBadge(p, false);
  p.path = [];
  p.onArrive = null;
  p.talking = p.hunting = p.inBed = p.leaving = p.atXray = false;
  p.scan = null;
  if (xray.shot?.p === p && xray.shot.result === 'running') xray.shot = null;
  dropSample(p);
  if (p.orTrip) { // on the way back the OR is already free, maybe for someone else
    if (p.orTrip !== 'back') orRoom.taken = false;
    p.orTrip = null;
    drawOR();
  }
  if (p.ward) { p.ward.taken = false; p.ward = null; }
  if (p.seat) { p.seat.taken = false; p.seat = null; }
  const qi = queue.indexOf(p);
  if (qi >= 0) {
    queue.splice(qi, 1);
    refreshQueue();
  }
  drawScreens();
  drawXray();
}

// ---------- a treated anomaly ----------
// It waits in bed until some normal patient lies in another ward, then walks over and eats them,
// and takes their bed, now glowing red. Locked in quarantine it can only bang on the door; nobody in there is prey either.
// Walking routes between a ward and the lobby run through that wing's corridor (x = ±5.8).
const bedside = (w) => v3(w.bedX - w.side * 0.9, w.zc + 0.5);
const wardToLobby = (w) => [v3(w.side * (CORRIDOR_X + 0.6), w.zc), v3(w.side * 5.8, w.zc), v3(w.side * 5.8, 0.8), v3(w.side * 4.4, 0.8)];
const lobbyToWard = (w) => [...wardToLobby(w).reverse(), bedside(w)];
// Stand up at the bedside and free the ward.
function getUp(p) {
  const w = p.ward;
  p.root.position.copy(bedside(w));
  p.root.rotation.set(0, -w.side * Math.PI / 2, 0);
  p.targetYaw = -w.side * Math.PI / 2;
  p.inBed = false;
  w.taken = false;
  p.ward = null;
  dropSample(p);
  p.analysis = null;
  drawScreens();
}
function hunt() {
  for (const p of patients) {
    if (!p.hunting || p.dying || p.talking || p.path.length || p.eating) continue;
    if (inQuarantine(p)) { bang(p); continue; }
    const prey = patients.find((q) => !q.anomaly && q.inBed && q.root.visible && q.ward !== p.ward && !inQuarantine(q));
    if (!prey) continue;
    if (p.inBed) getUp(p);
    // It stands at some ward's bedside (its own, or a prey's that got away): walk out of that ward.
    const at = p.root.position, dist = (w) => Math.hypot(bedside(w).x - at.x, bedside(w).z - at.z);
    const from = wards.reduce((a, w) => (dist(w) < dist(a) ? w : a));
    const w = prey.ward;
    const route = from.side === w.side ? [...wardToLobby(from).slice(0, 2), ...lobbyToWard(w).slice(2)]
      : [...wardToLobby(from), ...lobbyToWard(w)];
    p.walkTo(route, () => {
      if (prey.ward !== w || !prey.inBed || !prey.root.visible) return; // prey is gone, hunt() picks another
      p.eating = true;
      p.face(Math.atan2(w.bedX - p.root.position.x, w.zc + 0.75 - p.root.position.z));
      p.play(p.cfg.happy);
      log(`☠ ${p.cfg.name} їсть пацієнта: ${prey.cfg.name}!`);
      tween(1.2, (k) => prey.root.scale.setScalar(1 - k), () => {
        p.eating = false;
        if (p.dying) { prey.root.scale.setScalar(1); return; } // zapped mid-meal: the prey survives
        removePatient(prey);
        stats.eaten++;
        showStats();
        p.hunting = false;
        p.revealed = true;
        p.analysis = 'anomaly';
        tint(p, baseTint(p));
        lieDown(p, w);
        log(`☠ ${prey.cfg.name} з'їдено. ${p.cfg.name} лежить ${w.at}`);
      });
    });
    log(p.healed ? `${p.cfg.name} вилікувався… і йде ${w.to}` : `${p.cfg.name} встав із ліжка… і йде ${w.to}`);
  }
}
// A hunter locked in quarantine: says so once, then the door rattles every few game minutes.
function bang(p) {
  if (clockT < (p.bangAt ?? 0)) return;
  if (p.bangAt === undefined) log(`${p.cfg.name} гатить у двері карантину!`);
  p.bangAt = clockT + 6;
  tween(0.6, (k) => { quarantine.door.shake = Math.sin(k * Math.PI * 8) * 0.06 * (1 - k); });
}

// An untreated glutton gets hungrier in bed: first a warning the player can notice, then it hunts on its own.
function hunger() {
  for (const p of patients) {
    if (p.archetype !== 'glutton' || !p.inBed || p.healed || p.hunting || p.revealed || p.dying) continue;
    const stage = gluttonStage(p.inBedAt, clockT);
    if (stage !== 'calm' && !p.hungry) {
      p.hungry = true;
      tint(p, baseTint(p));
      log(`${cap(p.ward.at)} щось голосно бурчить…`);
    }
    if (stage === 'hunt') { p.hunting = true; log(`${p.cfg.name} не витримав голоду!`); }
  }
}

// The doctor is in a room (a ward, the lab) when he is past the corridor wall and within half a room (2 m) of its centre line.
const doctorIn = (w) => w.side * doctor.root.position.x > CORRIDOR_X && Math.abs(doctor.root.position.z - w.zc) < 2;
// A saboteur spoils its own sample in the lab analyzer (being analysed or waiting its turn) while the doctor is out
// of the lab, once per visit. Quarantine is sealed: from there it can't.
function sabotage(dt) {
  if (!doctor) return;
  for (const p of patients) {
    if (p.archetype !== 'saboteur' || !p.inBed || p.dying || inQuarantine(p)) continue;
    const r = sabotageStep(p.away, { sampleInLab: lab.queue.includes(p), doctorInLab: doctorIn(lab), used: p.sabotaged }, dt);
    p.away = r.away;
    if (!r.corrupt) continue;
    p.sabotaged = true;
    p.examined = false;
    dropSample(p);
    drawScreens();
    log(`${cap(p.ward.label)}: помилка сенсора — зразок пошкоджено!`);
  }
}

// ---------- game flow ----------
// Enter → through the sliding doors → queue at the service window → the doctor refers them to a room,
// or they sit on a lobby chair while he is away from the reception chair.
let patients = [];
let queue = [];
let clockT = 0;
let nextArrivalAt = 0;
let visitNo = 0; // arrival order, for calling lobby patients back to the queue
const loader = new GLTFLoader();
const clock = new THREE.Clock();

function refreshQueue() {
  queue.forEach((p, i) => {
    if (p.slot === i) return;
    p.slot = i;
    // Still on the way in: keep the route through the doors, just retarget the end.
    if (p.path.length) { p.path[p.path.length - 1] = queueSlot(i); return; }
    p.walkTo([queueSlot(i)], inLine(p));
  });
}
// Reached a queue slot: face the window; the reception dialog picks up whoever just stepped up to it.
const inLine = (p) => () => {
  p.face(Math.PI);
  if (dialog?.rc && !dialog.scanner && atWindow() === p) rcRefresh();
};

// A fresh visit: the same character can come back later in the shift with a new illness roll.
function resetVisit(p) {
  p.root.visible = false; p.path = []; p.ward = p.seat = p.skip = p.analysis = p.scan = p.archetype = p.xray = p.orTrip = null;
  p.step = p.away = p.opStep = 0;
  p.bangAt = undefined;
  p.inBed = p.examined = p.healed = p.anomaly = p.hunting = p.eating = p.dying = p.revealed = p.leaving = p.hungry = p.sabotaged = p.atXray = p.severe = false;
  p.root.scale.setScalar(1);
  tint(p, null);
  showBadge(p, false);
}

function enter(p, i) {
  resetVisit(p);
  const free = !patients.some((q) => q.anomaly && q.root.visible && !q.dying);
  p.anomaly = free && (FORCE !== null || Math.random() < ANOMALY_CHANCE);
  p.archetype = p.anomaly ? FORCE ?? pickArchetype() : null;
  p.severe = !p.anomaly && Math.random() < SEVERE_CHANCE;
  stats.visits++;
  if (p.anomaly) stats.anomalies++;
  p.root.position.set(-0.6 + i * 0.6, 0, 10.5);
  p.root.rotation.set(0, Math.PI, 0);
  p.root.visible = true;
  p.arrivalNo = ++visitNo;
  queue.push(p);
  p.slot = queue.length - 1;
  p.walkTo([DOOR_FRONT, DOOR_BACK, queueSlot(p.slot)], inLine(p));
  log(`${p.cfg.name} заходить до лікарні`);
}

// Lie down on the bed: front (+Z) turns up, head towards the pillow at -Z.
function lieDown(p, ward) {
  p.root.position.set(ward.bedX, 0.72, ward.zc + 0.75);
  p.root.rotation.set(-Math.PI / 2, 0, 0);
  p.targetYaw = 0;
  p.inBed = true;
  p.inBedAt = clockT;
  p.ward = ward;
  ward.taken = true;
  drawScreens();
}

// From the lobby side of the sliding doors through the corridor into the room: into the ward's bed,
// or to the X-ray screen, where the patient stands facing the room until the doctor takes the shot.
function sendToRoom(p, ward, lead) {
  ward.taken = true;
  p.ward = ward;
  if (ward === xray) {
    p.walkTo([...lead, DOOR_FRONT, ...wardToLobby(xray).reverse(), xray.stand], () => {
      p.face(0);
      p.atXray = true;
      if (xray.shot?.result !== 'running') xray.shot = null; // the viewer clears for the new patient
      drawXray();
      log(`${p.cfg.name} стоїть біля рентгена`);
      if (dialog?.xray) show(xrayNode());
    });
  } else {
    p.walkTo([...lead, DOOR_FRONT, ...lobbyToWard(ward)], () => {
      lieDown(p, ward);
      log(`${p.cfg.name} лежить ${ward.at}`);
    });
  }
  log(`${p.cfg.name} іде ${ward.to}`);
}

// Step out of the queue line sideways first, so we don't walk through the patients behind.
const asideOf = (p) => v3(HATCH_X - 1.1, p.root.position.z);

// The doctor's referral of the patient at the window: to a free room, or 'lobby' to wait on a chair.
// Returns false when it can't be done (not at the window, room taken). __game.refer calls this too.
function refer(p, key) {
  if (!p || atWindow() !== p) return false;
  const room = key === 'lobby' || rooms.find((r) => r.key === key && !r.taken && mayUse(p, r));
  if (!room) return false;
  if (key === 'lobby') { toLobby(p, true); return true; }
  queue.shift();
  sendToRoom(p, room, [asideOf(p), DOOR_BACK]);
  refreshQueue();
  return true;
}

// Leave the queue for a lobby chair. told: the doctor asked to wait, so the rooms free right now don't count
// for coming back (p.skip); otherwise the doctor is away from his chair.
function toLobby(p, told) {
  queue.splice(queue.indexOf(p), 1);
  const spot = chairSpots.find((s) => !s.taken); // there are more chairs than patients can be inside
  spot.taken = true;
  p.seat = spot;
  p.skip = told ? new Set(rooms.filter((r) => !r.taken).map((r) => r.key)) : null;
  p.walkTo([asideOf(p), DOOR_BACK, DOOR_FRONT, v3(0, spot.pos.z), spot.pos], () => p.face(spot.facing));
  log(told ? `${p.cfg.name} чекає у вестибюлі` : `${p.cfg.name} чекає на лікаря у вестибюлі`);
  refreshQueue();
}

// Doctor away from the reception chair: whoever reaches a queue slot goes to sit down.
// Doctor seated: lobby patients come back in arrival order, as many as there are free rooms nobody queues for.
function lobbyWait() {
  if (!doctor) return;
  if (!doctor.seated) {
    for (const p of [...queue]) if (!p.path.length && !p.talking) toLobby(p, false);
    for (const p of patients) p.skip = null; // told to wait, but the doctor went off: ask again when he is back
    return;
  }
  const free = rooms.filter((r) => !r.taken);
  let places = free.length - queue.length;
  const waiting = patients.filter((p) => p.seat && !p.path.length && !p.talking && !p.dying)
    .sort((a, b) => a.arrivalNo - b.arrivalNo);
  for (const p of waiting) {
    if (places <= 0) return;
    // A room taken since "wait" and freed again counts as newly free.
    if (p.skip) for (const k of p.skip) if (!free.some((r) => r.key === k)) p.skip.delete(k);
    if (!free.some((r) => mayUse(p, r) && !p.skip?.has(r.key))) continue;
    places--;
    toQueue(p);
  }
}
function toQueue(p) {
  const spot = p.seat;
  spot.taken = false;
  p.seat = p.skip = null;
  queue.push(p);
  p.slot = queue.length - 1;
  p.walkTo([v3(0, spot.pos.z), DOOR_FRONT, DOOR_BACK, queueSlot(p.slot)], inLine(p));
  log(`${p.cfg.name} повертається до віконця`);
}

// Cured patients rest a little, then get up and walk out through the entrance.
function discharge() {
  for (const p of patients) {
    if (!p.healed || p.anomaly || !p.inBed || p.talking || clockT < p.dischargeAt) continue;
    const route = wardToLobby(p.ward);
    getUp(p);
    showBadge(p, false);
    p.leaving = true;
    p.walkTo([...route, DOOR_FRONT, v3(0, 10.8)],
      () => removePatient(p));
    log(`${p.cfg.name} іде додому здоровим`);
  }
}

// One random character from outside walks in at a time, while fewer are inside than there are beds. While every ward is spoken for, the timer keeps
// being pushed back, so the next one comes a while after someone goes home, gets eaten or is zapped.
// Whoever has gone comes back later as a new patient, until the shift is nearly over.
function arrivals() {
  if (clockT - shiftAt > SHIFT_LEN - LAST_ARRIVAL) return;
  const inside = patients.filter((p) => p.root.visible).length;
  const outside = patients.filter((p) => !p.root.visible);
  if (inside >= wards.length || !outside.length) { nextArrivalAt = clockT + rand(REFILL_GAP); return; }
  if (clockT < nextArrivalAt) return;
  const p = outside[Math.floor(Math.random() * outside.length)];
  enter(p, patients.indexOf(p));
  nextArrivalAt = clockT + rand(ARRIVAL_GAP);
}

function restart() {
  if (dialog) { doctor.busy = false; closeDialog(); }
  if (doctor) { doctor.timer = null; doctor.busy = false; sitDown(); } // e.g. an examination cut short by the end of the shift
  coffeeUntil = 0;
  choco.visible = true;
  rcScreen.last = null;
  drawRcScreen();
  patients.forEach(resetVisit);
  tweens = [];
  quarantine.door.shake = 0;
  held = null;
  showHeld();
  Object.assign(lab, { queue: [], run: null, last: null, progress: 0 });
  drawLab();
  bolt.visible = false;
  Object.keys(stats).forEach((k) => { stats[k] = 0; });
  showStats();
  chairSpots.forEach((s) => { s.taken = false; });
  rooms.forEach((r) => { r.taken = false; });
  orRoom.taken = false;
  drawOR();
  xray.shot = null;
  drawXray();
  queue = [];
  visitNo = 0;
  clockT = 0;
  shiftAt = 0;
  shiftNo = 1;
  nextArrivalAt = 1;
  over = false;
  if (!$('over').hidden) { $('over').hidden = true; paused = false; }
  drawScreens();
}
$('restart').onclick = askRestart;

Promise.all(CHARACTERS.map((cfg) => loader.loadAsync(cfg.url).then((g) => new Patient(cfg, g))))
  .then((list) => {
    patients = list;
    for (const p of patients) { p.root.visible = false; scene.add(p.root); }
    restart();
    log('Пацієнти в дорозі…');
  })
  .catch((err) => { log('Помилка завантаження: ' + err.message); console.error(err); });

loader.loadAsync(DOCTOR.url)
  .then((g) => {
    doctor = new Doctor(DOCTOR, g);
    doctor.turnRate = PLAYER_TURN;
    scene.add(doctor.root);
    sitDown(); // at the reception desk
    followDoctor();
  })
  .catch((err) => { log('Помилка завантаження: ' + err.message); console.error(err); });

// ---------- loop ----------
// The camera hangs behind the doctor's head along the look direction; walls in between fade (fadeOccluders).
function followDoctor() {
  const pivot = doctor.root.position.clone();
  pivot.y = PIVOT_Y;
  const cp = Math.cos(look.pitch);
  camera.position.set(
    pivot.x - Math.sin(look.yaw) * cp * look.dist,
    pivot.y + Math.sin(look.pitch) * look.dist,
    pivot.z - Math.cos(look.yaw) * cp * look.dist);
  camera.lookAt(pivot);
}

function updateDoors(dt) {
  const walkers = doctor ? [...patients, doctor] : patients;
  const near = walkers.some((p) => p.root.visible && Math.hypot(p.root.position.x, p.root.position.z) < 1.8);
  for (const d of doorPanels) {
    const goal = near ? d.openX : d.closedX;
    d.mesh.position.x += (goal - d.mesh.position.x) * Math.min(1, dt * 5);
  }
  const staffNear = doctor && Math.hypot(doctor.root.position.x - 5, doctor.root.position.z - STAFF_DOOR_Z) < 1.4;
  staffDoor.rotation.y += ((staffNear ? -Math.PI / 2 : 0) - staffDoor.rotation.y) * Math.min(1, dt * 5);
  // Quarantine: opens for the doctor, for its patient walking in, and for a cured patient on the way home.
  const q = quarantine, qd = q.door, mid = v3(qd.position.x, q.zc);
  const atDoor = (o) => o.root.visible && Math.hypot(o.root.position.x - mid.x, o.root.position.z - mid.z) < 1.4;
  const qOpen = (doctor && atDoor(doctor)) || patients.some((p) => atDoor(p) && (p.leaving || (p.ward === q && !p.inBed)));
  qd.angle = (qd.angle ?? 0) + ((qOpen ? q.side * Math.PI / 2 : 0) - (qd.angle ?? 0)) * Math.min(1, dt * 5);
  qd.rotation.y = qd.angle + qd.shake;
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop(() => {
  const realDt = Math.min(clock.getDelta(), 0.1);
  if (paused) return renderer.render(scene, camera);
  const dt = realDt * speed;
  clockT += dt;
  $('clock').textContent = `🕗 Зміна ${shiftNo}: ${clockText(clockT)} · до ${clockText(shiftAt + SHIFT_LEN)}`
    + (clockT < coffeeUntil ? ` · ☕ до ${clockText(coffeeUntil)}` : '');
  if (clockT - shiftAt >= SHIFT_LEN) { endShift(); return renderer.render(scene, camera); }
  arrivals();
  hunt();
  hunger();
  sabotage(realDt);
  discharge();
  lobbyWait();
  patients.forEach((p) => p.root.visible && p.update(dt));
  updateTweens(realDt);
  if (doctor) {
    updatePlayer(realDt); // the player's pace doesn't follow the game-speed slider
    doctor.update(realDt);
  }
  separate();
  if (doctor) {
    if (!doctor.seated) pushOut(doctor.root.position, PLAYER_R); // a patient may have nudged him into a wall
    followDoctor();
  }
  for (const p of patients) if (p.badge?.visible) placeBadge(p);
  updateNearby();
  $('lookHint').hidden = look.locked || !!dialog;
  updateDoors(dt);
  if (doctor) fadeOccluders(realDt);
  renderer.render(scene, camera);
});

// Debug handle for automated checks.
window.__game = { camera, look, get patients() { return patients; }, get doctor() { return doctor; }, occluders, get queue() { return queue; }, get dialog() { return dialog; }, keys, wards, rooms, refer, sitDown, standUp, stats, zap, nodesFor, get nearby() { return nearby; }, get t() { return clockT; }, set t(v) { clockT = v; }, get paused() { return paused; }, setPaused, get held() { return held; }, xrayShot, lab, labAnalyze, or: orRoom, toOR, examine, get over() { return over; }, staffSpots, staffDoor, choco, get coffeeUntil() { return coffeeUntil; } };
