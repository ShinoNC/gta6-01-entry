import * as THREE from 'three';
export const MISSIONS_IN_STORY = 8;
const ARRIVE_M = 15;
const MARKER_M = 6;
const MISSION_CHAIN = [
  {
    name: 'FIRST FARE',
    giver: 'Mara Solis',
    start: [52, 0],
    briefing:
      'Rook. Mara Solis. Word is you can drive. Prove it — my client is waiting at the east pier. Pick them up, then drop them at Palm Row. Do not keep them waiting.',
    rewardMoney: 500,
    rewardRep: 60,
    objectives: [
      { kind: 'driveTo', x: 104, z: 0, needsCar: true, label: 'Pick up the client at the east pier' },
      { kind: 'waitAt', x: 104, z: 0, seconds: 2, needsCar: true, label: 'Wait for the client to get in' },
      { kind: 'driveTo', x: -52, z: 52, label: 'Drop the client at Palm Row' },
    ],
  },
  {
    name: 'THE CORAL RUN',
    giver: 'Juno Reyes',
    start: [-52, 70],
    briefing:
      'Rook. Juno. I am stranded on Coral Strand and my ride is not coming. Come get me, then drop me at Sunset Bluff — and treat the car like it is yours, because soon it will be.',
    rewardMoney: 750,
    rewardRep: 90,
    objectives: [
      { kind: 'waitAt', x: -52, z: 70, seconds: 2, needsCar: true, label: 'Pick up Juno Reyes on Coral Strand' },
      { kind: 'driveTo', x: 104, z: 70, label: 'Drop Juno at Sunset Bluff' },
    ],
  },
  {
    name: 'HEAT ON WHEELS',
    giver: 'Mara Solis',
    start: [-104, -104],
    briefing:
      'The drop is blown — the Keys police are on you the second you move. Shake them, then bring the package to Old Port. I left an SMG in the glovebox for the trouble.',
    rewardMoney: 1000,
    rewardRep: 120,
    rewardWeapon: 'smg',
    scriptedHeat: 2,
    objectives: [
      { kind: 'loseWanted', label: 'Lose the heat — break line of sight' },
      { kind: 'driveTo', x: -104, z: -104, label: 'Deliver the package to Old Port' },
    ],
  },
  {
    name: 'KEYS TO THE CITY',
    giver: 'Juno Reyes',
    start: [52, -104],
    briefing:
      'Rook. Juno. A Sunset Coupe is sitting in Harbor Lights with the keys in it. I did not say steal it. I said it needs a new garage in Old Port — mine.',
    rewardMoney: 1250,
    rewardRep: 140,
    scriptedHeat: 1,
    objectives: [
      { kind: 'stealCar', carName: 'SUNSET COUPE', label: 'Steal the Sunset Coupe in Harbor Lights' },
      { kind: 'driveTo', x: -156, z: -104, label: 'Deliver the Coupe to the Old Port garage' },
    ],
  },
  {
    name: 'SUNSET BLUFF DROP',
    giver: 'Juno Reyes',
    start: [130, 70],
    briefing:
      'Rook. Juno. Sunset Bluff, top of the hill, one package, no questions. Wait for the nod, then come straight back to Marina Del Sol.',
    rewardMoney: 1500,
    rewardRep: 160,
    objectives: [
      { kind: 'driveTo', x: 130, z: 70, label: 'Drive to Sunset Bluff' },
      { kind: 'waitAt', x: 130, z: 70, seconds: 3, label: 'Make the drop — hold position' },
      { kind: 'driveTo', x: 52, z: 0, label: 'Return to Marina Del Sol' },
    ],
  },
  {
    name: 'THE GETAWAY',
    giver: 'Mara Solis',
    start: [104, -104],
    briefing:
      'Three stars, a helicopter, and a roadblock with your name on it. Get clean and get to Harbor Lights. This is the job that makes your name.',
    rewardMoney: 1750,
    rewardRep: 180,
    scriptedHeat: 3,
    objectives: [
      { kind: 'loseWanted', label: 'Lose the heat — 3 stars, helicopter overhead' },
      { kind: 'driveTo', x: 104, z: -104, label: 'Reach the Harbor Lights safehouse' },
    ],
  },
  {
    name: 'HARBOR LIGHTS HEIST',
    giver: 'Otto Kane',
    start: [104, -104],
    briefing:
      'Rook. Otto Kane. The crew is waiting at Harbor Lights. Pick them up, crack the vault, and be in Palm Row before the sirens find their pitch. My cut is my cut — do not get creative.',
    rewardMoney: 2500,
    rewardRep: 240,
    objectives: [
      { kind: 'waitAt', x: 104, z: -104, seconds: 2, needsCar: true, label: 'Pick up the crew at Harbor Lights' },
      { kind: 'waitAt', x: -52, z: -104, seconds: 4, label: 'Crack the vault — hold position' },
      { kind: 'driveTo', x: -104, z: 26, label: 'Escape to Palm Row' },
    ],
  },
  {
    name: 'KING OF THE KEYS',
    giver: 'Mara Solis',
    start: [-52, 70],
    briefing:
      'One last drive. Meet me on Coral Strand at sunset, then we take the Bluff road together — Juno, the crew, all of us. After tonight, the Keys are yours, Rook.',
    rewardMoney: 4000,
    rewardRep: 400,
    finale: true,
    objectives: [
      { kind: 'driveTo', x: -52, z: 70, label: 'Drive to Coral Strand beach' },
      { kind: 'waitAt', x: -52, z: 70, seconds: 3, label: 'Meet Mara and the crew on the beach' },
      { kind: 'driveTo', x: 130, z: 52, label: 'Take the Bluff road — the victory lap' },
      { kind: 'waitAt', x: 130, z: 52, seconds: 3, label: 'Watch the sunset — King of the Keys' },
    ],
  },
];
export function buildBeacon(scene, color = 0xffe600) {
  const group = new THREE.Group();
  // Near-solid saturated yellow, fog-proof: the pillar reads against the
  // sunset sky from 100m out. The diamond shares this material, so it reads
  // as solid gold too.
  const pillarMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.FrontSide, depthWrite: false, fog: false });
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 45, 12, 1, true), pillarMaterial);
  pillar.position.y = 22.5;
  const ringMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, fog: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(3, 4.2, 24), ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(1.7, 0), pillarMaterial);
  diamond.position.y = 7;
  group.add(pillar, ring, diamond);
  group.visible = false;
  scene.add(group);
  return { group, pillar, ring, diamond };
}
export class Missions {
  constructor(scene, callbacks) {
    this.callbacks = callbacks;
    this.status = MISSION_CHAIN.map(() => 'locked');
    this.status[0] = 'pending';
    this.curIdx = -1;
    this.stageIndex = 0;
    this.waitSeconds = 0;
    this.briefingIdx = 0;
    this.snooze = 0;
    this.briefingArmed = true;
    this.needsCarHint = false;
    this.atMarker = false;
    this.target = null;
    this.clock = 0;
    this.missionClock = 0;
    this.parSeconds = 0;
    this.beacon = buildBeacon(scene);
  }
  get pendingBriefing() {
    if (this.briefingIdx < 0 || this.curIdx >= 0 || this.snooze > 0 || !this.atMarker || !this.briefingArmed) return null;
    return { mission: MISSION_CHAIN[this.briefingIdx], index: this.briefingIdx };
  }
  // Next mission waiting at its gold marker, or null once the story is done.
  get pendingMission() {
    return this.briefingIdx >= 0 ? MISSION_CHAIN[this.briefingIdx] : null;
  }
  currentMission() {
    return this.curIdx >= 0 ? MISSION_CHAIN[this.curIdx] : null;
  }
  currentObjective() {
    const mission = this.currentMission();
    return mission ? mission.objectives[this.stageIndex] : null;
  }
  doneCount() {
    return this.status.filter((status) => status === 'done').length;
  }
  snoozeBriefing(seconds) {
    this.snooze = seconds;
  }
  // LATER pressed: the briefing stays shut until the player leaves the
  // marker area (>15m) and comes back — crossing the area must not force
  // ACCEPT or LATER on the player again and again.
  dismissBriefing() {
    this.briefingArmed = false;
  }
  // Resume a mission mid-way (save/load): same state as startMission but
  // without the scripted heat or the started callback — both already
  // happened when the mission first began.
  restoreActive(index, stage, clock) {
    const mission = MISSION_CHAIN[index];
    this.curIdx = index;
    this.stageIndex = stage;
    this.waitSeconds = 0;
    this.missionClock = clock || 0;
    this.parSeconds = 90 + mission.objectives.length * 45;
    this.status[index] = 'active';
    this.briefingIdx = -1;
    this.snooze = 0;
    this.briefingArmed = true;
  }
  startMission(index) {
    const mission = MISSION_CHAIN[index];
    this.curIdx = index;
    this.stageIndex = 0;
    this.waitSeconds = 0;
    this.missionClock = 0;
    this.parSeconds = 90 + mission.objectives.length * 45;
    this.status[index] = 'active';
    this.briefingIdx = -1;
    this.snooze = 0;
    if (mission.scriptedHeat) this.callbacks.onScriptedHeat(mission.scriptedHeat);
    this.callbacks.onMissionStarted(mission, index);
  }
  forceStart(index) {
    this.briefingIdx = -1;
    this.startMission(index);
  }
  failCurrent() {
    if (this.curIdx < 0) return;
    this.status[this.curIdx] = 'pending';
    this.briefingIdx = this.curIdx;
    this.briefingArmed = true;
    this.snooze = 5;
    this.curIdx = -1;
    this.target = null;
    this.beacon.group.visible = false;
  }
  setCompleted(count) {
    for (let i = 0; i < MISSIONS_IN_STORY; i += 1) {
      this.status[i] = i < count ? 'done' : 'locked';
    }
    if (count < MISSIONS_IN_STORY) {
      this.status[count] = 'pending';
      this.briefingIdx = count;
      this.briefingArmed = true;
      this.snooze = 1;
    } else {
      this.briefingIdx = -1;
    }
  }
  completeStage() {
    const mission = this.currentMission();
    this.stageIndex += 1;
    this.waitSeconds = 0;
    this.callbacks.onObjectiveComplete();
    if (this.stageIndex < mission.objectives.length) return;
    const finishedIndex = this.curIdx;
    this.status[finishedIndex] = 'done';
    this.curIdx = -1;
    this.target = null;
    const nextIndex = finishedIndex + 1;
    if (nextIndex < MISSIONS_IN_STORY) {
      this.status[nextIndex] = 'pending';
      this.briefingIdx = nextIndex;
      this.briefingArmed = true;
      this.snooze = 2;
    }
    this.callbacks.onMissionComplete(mission, finishedIndex);
  }
  animateBeacon(dt) {
    const b = this.beacon;
    b.pillar.material.opacity = 0.85 + 0.1 * Math.sin(this.clock * 3);
    const s = 1 + 0.07 * Math.sin(this.clock * 3);
    b.ring.scale.set(s, s, 1);
    b.diamond.rotation.y += dt * 1.5;
    b.diamond.position.y = 7 + Math.sin(this.clock * 2) * 0.6;
  }
  update(dt, context) {
    this.clock += dt;
    this.snooze = Math.max(0, this.snooze - dt);
    const mission = this.currentMission();
    if (!mission) {
      // Free roam: the gold marker for the next mission waits at its start.
      const next = this.pendingMission;
      this.target = next ? { x: next.start[0], z: next.start[1] } : null;
      this.beacon.group.visible = this.target !== null;
      if (this.target) {
        this.beacon.group.position.set(this.target.x, 0, this.target.z);
        this.animateBeacon(dt);
        const dist = Math.hypot(context.playerPos.x - this.target.x, context.playerPos.z - this.target.z);
        this.atMarker = dist < MARKER_M;
        // Leaving the area re-arms a dismissed briefing.
        if (!this.briefingArmed && dist > 15) this.briefingArmed = true;
      } else {
        this.atMarker = false;
      }
      return;
    }
    this.missionClock += dt;
    this.needsCarHint = false;
    const objective = mission.objectives[this.stageIndex];
    const { playerPos, drivenCar, cars, wantedStars } = context;
    if (objective.kind === 'stealCar') {
      const car = cars.find((candidate) => candidate.name === objective.carName);
      this.target = car ? { x: car.position.x, z: car.position.z } : null;
    } else if (objective.kind === 'loseWanted') {
      this.target = null;
    } else {
      this.target = { x: objective.x, z: objective.z };
    }
    this.beacon.group.visible = this.target !== null;
    if (this.target) {
      this.beacon.group.position.set(this.target.x, 0, this.target.z);
      this.animateBeacon(dt);
    }
    if (objective.kind === 'driveTo') {
      const inRange = Math.hypot(playerPos.x - objective.x, playerPos.z - objective.z) < ARRIVE_M;
      // A pickup needs a car: arriving on foot holds the stage and hints
      // at it instead of letting the client "get in" with no car there.
      if (objective.needsCar && !drivenCar) {
        this.needsCarHint = inRange;
      } else if (inRange) {
        this.completeStage();
      }
    } else if (objective.kind === 'waitAt') {
      const inRange = Math.hypot(playerPos.x - objective.x, playerPos.z - objective.z) < ARRIVE_M;
      if (objective.needsCar && !drivenCar) {
        this.waitSeconds = 0;
        this.needsCarHint = inRange;
      } else if (inRange) {
        this.waitSeconds += dt;
        if (this.waitSeconds >= objective.seconds) this.completeStage();
      } else {
        this.waitSeconds = 0;
      }
    } else if (objective.kind === 'loseWanted') {
      if (wantedStars === 0) this.completeStage();
    } else if (objective.kind === 'stealCar') {
      if (drivenCar && drivenCar.name === objective.carName) this.completeStage();
    }
  }
  progressLine() {
    if (this.curIdx < 0) return this.doneCount() >= MISSIONS_IN_STORY ? 'STORY COMPLETE' : 'FREE ROAM';
    const mission = this.currentMission();
    // Par is display-only (no fail), but a timer stuck at 0:00 looks
    // broken — past par it counts up over par instead.
    const over = this.missionClock - this.parSeconds;
    const timer =
      over > 0
        ? `+${Math.floor(over / 60)}:${String(Math.floor(over % 60)).padStart(2, '0')} OVER PAR`
        : `${Math.floor((this.parSeconds - this.missionClock) / 60)}:${String(Math.floor((this.parSeconds - this.missionClock) % 60)).padStart(2, '0')}`;
    return `MISSION ${this.curIdx + 1}/${MISSIONS_IN_STORY} — ${mission.name} · STAGE ${this.stageIndex + 1}/${mission.objectives.length} · ${timer}`;
  }
  nextLine() {
    const mission = this.currentMission();
    if (!mission) return '';
    const next = mission.objectives[this.stageIndex + 1];
    return next ? next.label : `Finish the job — report to ${mission.giver.split(' ')[0]}`;
  }
  nextObjectiveLine() {
    const objective = this.currentObjective();
    if (!objective) return null;
    if (objective.kind === 'waitAt' && this.waitSeconds > 0) {
      return `${objective.label} — ${Math.max(0, objective.seconds - this.waitSeconds).toFixed(1)}s`;
    }
    return objective.label;
  }
  statusList() {
    return MISSION_CHAIN.map((mission, index) => ({
      number: index + 1,
      name: mission.name,
      giver: mission.giver,
      briefing: mission.briefing,
      rewardMoney: mission.rewardMoney,
      rewardRep: mission.rewardRep,
      objectiveCount: mission.objectives.length,
      finale: Boolean(mission.finale),
      status: this.status[index],
    }));
  }
}