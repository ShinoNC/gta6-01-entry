// The story: 8 jobs from fixer Mara Solis for Rook, a driver new to
// Solaris Keys. Every mission is waypoint-based — drive to the beacon, wait
// out a pickup, lose the heat — with generous or no timers. Completing a
// job pays cash and REP; one job unlocks the SMG. Rewards rise through the
// chain so the finale pays the most, and the finale ends with the whole
// crew on the beach at sunset. A yellow light pillar marks the current
// target in 3D.
import * as THREE from 'three';

export const MISSIONS_IN_STORY = 8;
const WAYPOINT_ARRIVE_METRES = 10;

export const MISSION_CHAIN = [
  {
    name: 'FIRST FARE',
    giver: 'Mara Solis',
    briefing:
      'Rook. Mara Solis. Word is you can drive. Prove it — pick up my client at Marina Del Sol. Do not keep them waiting.',
    rewardMoney: 500,
    rewardRep: 60,
    objectives: [{ kind: 'driveTo', x: 52, z: 26, label: 'Drive to the Marina Del Sol pickup' }],
  },
  {
    name: 'THE CORAL RUN',
    giver: 'Mara Solis',
    briefing:
      'Juno Reyes needs a lift off Coral Strand, fast. She is a wheelwoman — treat her car like it is your own, because soon it will be.',
    rewardMoney: 750,
    rewardRep: 90,
    objectives: [
      { kind: 'waitAt', x: -52, z: 52, seconds: 2, label: 'Pick up Juno Reyes on Coral Strand' },
      { kind: 'driveTo', x: 104, z: 52, label: 'Drop Juno at Sunset Bluff' },
    ],
  },
  {
    name: 'HEAT ON WHEELS',
    giver: 'Mara Solis',
    briefing:
      'The drop is blown — the Keys police are on you the second you move. Shake them, then bring the package to Old Port. I left an SMG in the glovebox for the trouble.',
    rewardMoney: 1000,
    rewardRep: 120,
    rewardWeapon: 'SMG',
    scriptedHeat: 2,
    objectives: [
      { kind: 'loseWanted', label: 'Lose the heat — break line of sight' },
      { kind: 'driveTo', x: -104, z: -104, label: 'Deliver the package to Old Port' },
    ],
  },
  {
    name: 'KEYS TO THE CITY',
    giver: 'Mara Solis',
    briefing:
      'A Sunset Coupe is parked in Palm Row with the keys in it. I did not say steal it. I said it needs a new garage in Old Port.',
    rewardMoney: 1250,
    rewardRep: 140,
    objectives: [
      { kind: 'stealCar', carName: 'SUNSET COUPE', label: 'Steal the Sunset Coupe in Palm Row' },
      { kind: 'driveTo', x: -156, z: -104, label: 'Deliver the Coupe to the Old Port garage' },
    ],
  },
  {
    name: 'SUNSET BLUFF DROP',
    giver: 'Mara Solis',
    briefing:
      'Sunset Bluff, top of the hill, one package, no questions. Wait for the nod, then come straight back to Marina Del Sol.',
    rewardMoney: 1500,
    rewardRep: 160,
    objectives: [
      { kind: 'driveTo', x: 130, z: 52, label: 'Drive to Sunset Bluff' },
      { kind: 'waitAt', x: 130, z: 52, seconds: 3, label: 'Make the drop — hold position' },
      { kind: 'driveTo', x: 52, z: 26, label: 'Return to Marina Del Sol' },
    ],
  },
  {
    name: 'THE GETAWAY',
    giver: 'Mara Solis',
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
    giver: 'Mara Solis',
    briefing:
      'The crew is waiting at Harbor Lights. Pick them up, crack the vault, and be in Palm Row before the sirens find their pitch.',
    rewardMoney: 2500,
    rewardRep: 240,
    objectives: [
      { kind: 'waitAt', x: 104, z: -104, seconds: 2, label: 'Pick up the crew at Harbor Lights' },
      { kind: 'waitAt', x: -52, z: -104, seconds: 4, label: 'Crack the vault — hold position' },
      { kind: 'driveTo', x: -104, z: 26, label: 'Escape to Palm Row' },
    ],
  },
  {
    name: 'KING OF THE KEYS',
    giver: 'Mara Solis',
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

function buildBeacon(scene) {
  const group = new THREE.Group();
  const pillarMaterial = new THREE.MeshBasicMaterial({ color: 0xffd978, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 30, 12, 1, true), pillarMaterial);
  pillar.position.y = 15;
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffd978, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 3.1, 24), ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  group.add(pillar, ring);
  group.visible = false;
  scene.add(group);
  return { group, pillar };
}

export class Missions {
  constructor(scene, callbacks) {
    this.callbacks = callbacks;
    this.status = MISSION_CHAIN.map(() => 'locked');
    this.status[0] = 'pending';
    this.currentMissionIndex = -1;
    this.stageIndex = 0;
    this.waitSeconds = 0;
    this.pendingBriefingIndex = 0;
    this.briefingSnooze = 1;
    this.target = null;
    this.clock = 0;
    this.beacon = buildBeacon(scene);
  }

  // The briefing the phone panel should show right now, or null.
  get pendingBriefing() {
    if (this.pendingBriefingIndex < 0 || this.currentMissionIndex >= 0 || this.briefingSnooze > 0) return null;
    return { mission: MISSION_CHAIN[this.pendingBriefingIndex], index: this.pendingBriefingIndex };
  }

  currentMission() {
    return this.currentMissionIndex >= 0 ? MISSION_CHAIN[this.currentMissionIndex] : null;
  }

  currentObjective() {
    const mission = this.currentMission();
    return mission ? mission.objectives[this.stageIndex] : null;
  }

  doneCount() {
    return this.status.filter((status) => status === 'done').length;
  }

  snoozeBriefing(seconds) {
    this.briefingSnooze = seconds;
  }

  startMission(index) {
    const mission = MISSION_CHAIN[index];
    this.currentMissionIndex = index;
    this.stageIndex = 0;
    this.waitSeconds = 0;
    this.status[index] = 'active';
    this.pendingBriefingIndex = -1;
    this.briefingSnooze = 0;
    if (mission.scriptedHeat) this.callbacks.onScriptedHeat(mission.scriptedHeat);
    this.callbacks.onMissionStarted(mission, index);
  }

  forceStart(index) {
    this.pendingBriefingIndex = -1;
    this.startMission(index);
  }

  setCompleted(count) {
    for (let i = 0; i < MISSIONS_IN_STORY; i += 1) {
      this.status[i] = i < count ? 'done' : 'locked';
    }
    if (count < MISSIONS_IN_STORY) {
      this.status[count] = 'pending';
      this.pendingBriefingIndex = count;
      this.briefingSnooze = 1;
    } else {
      this.pendingBriefingIndex = -1;
    }
  }

  completeStage() {
    const mission = this.currentMission();
    this.stageIndex += 1;
    this.waitSeconds = 0;
    this.callbacks.onObjectiveComplete();
    if (this.stageIndex < mission.objectives.length) return;
    const finishedIndex = this.currentMissionIndex;
    this.status[finishedIndex] = 'done';
    this.currentMissionIndex = -1;
    this.target = null;
    const nextIndex = finishedIndex + 1;
    if (nextIndex < MISSIONS_IN_STORY) {
      this.status[nextIndex] = 'pending';
      this.pendingBriefingIndex = nextIndex;
      this.briefingSnooze = 2;
    }
    this.callbacks.onMissionComplete(mission, finishedIndex);
  }

  update(dt, context) {
    this.clock += dt;
    this.briefingSnooze = Math.max(0, this.briefingSnooze - dt);
    const mission = this.currentMission();
    if (!mission) {
      this.target = null;
      this.beacon.group.visible = false;
      return;
    }
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
      this.beacon.pillar.material.opacity = 0.2 + 0.1 * Math.sin(this.clock * 3);
    }

    if (objective.kind === 'driveTo') {
      if (Math.hypot(playerPos.x - objective.x, playerPos.z - objective.z) < WAYPOINT_ARRIVE_METRES) {
        this.completeStage();
      }
    } else if (objective.kind === 'waitAt') {
      if (Math.hypot(playerPos.x - objective.x, playerPos.z - objective.z) < WAYPOINT_ARRIVE_METRES) {
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
    if (this.currentMissionIndex < 0) return this.doneCount() >= MISSIONS_IN_STORY ? 'STORY COMPLETE' : 'FREE ROAM';
    const mission = this.currentMission();
    return `MISSION ${this.currentMissionIndex + 1}/${MISSIONS_IN_STORY} · STAGE ${this.stageIndex + 1}/${mission.objectives.length}`;
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
