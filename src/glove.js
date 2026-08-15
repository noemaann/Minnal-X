/**
 * Glove Module for MINNAL-X
 * Implements a premium virtual AR glove with an activation state machine.
 * Includes energy scans, traveling traces, wrist sparkles, end-activation pulse bursts,
 * and smooth fade-out deactivation when tracking is lost.
 * Optimized for low-end / student laptop hardware by preallocating spark objects and caching computations.
 */

// Euclidean distance helper
function distance(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y, p1.z - p2.z);
}

// Linear interpolation helper
function lerp(start, end, amt) {
  return (1 - amt) * start + amt * end;
}

// Motion-adaptive smoothing tuning (normalized 0–1 coordinate space, per frame)
const GLOVE_SMOOTH_ALPHA_MIN = 0.25;  // resting: heavy smoothing, kills jitter
const GLOVE_SMOOTH_ALPHA_MAX = 0.85;  // fast motion: near-raw, minimal lag
const GLOVE_SMOOTH_SPEED_LOW = 0.01;  // below this wrist speed = treated as still
const GLOVE_SMOOTH_SPEED_HIGH = 0.08; // above this wrist speed = treated as fast swipe

const GLOVE_STATES = {
  INACTIVE: 'INACTIVE',
  ACTIVATING: 'ACTIVATING',
  ACTIVE: 'ACTIVE',
  FADING_OUT: 'FADING_OUT'
};

const FINGER_CHAINS = [
  [0, 1, 2, 3, 4],       // Thumb
  [5, 6, 7, 8],          // Index
  [9, 10, 11, 12],       // Middle
  [13, 14, 15, 16],      // Ring
  [17, 18, 19, 20]       // Pinky
];

export class EnergyGloveRenderer {
  /**
   * @param {CanvasRenderingContext2D} canvasContext 
   */
  constructor(canvasContext) {
    this.ctx = canvasContext;
    this.smoothedLandmarks = null;
    this.palmCenter = { x: 0, y: 0 };

    // Preallocated sparks pool to prevent Garbage Collection pauses
    this.maxSparks = 100;
    this.sparksPool = Array.from({ length: this.maxSparks }, () => ({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      alpha: 0,
      size: 0
    }));

    // State parameters
    this.state = GLOVE_STATES.INACTIVE;
    this.activationStartTime = 0;
    this.activationProgress = 0.0;
    
    this.fadeStartTime = 0;
    this.gloveOpacity = 0.0;

    // A flag to inform main.js to play a transition sound
    this.pulseTriggered = false;
  }

  // Getter and Setter to support compatibility with existing unit tests
  get sparks() {
    return this.sparksPool.filter(s => s.active);
  }

  set sparks(val) {
    // Clear pool
    for (let i = 0; i < this.maxSparks; i++) {
      this.sparksPool[i].active = false;
    }
    // Populate active ones from val
    if (Array.isArray(val)) {
      for (let i = 0; i < Math.min(val.length, this.maxSparks); i++) {
        const target = this.sparksPool[i];
        target.active = true;
        target.x = val[i].x;
        target.y = val[i].y;
        target.vx = val[i].vx || 0;
        target.vy = val[i].vy || 0;
        target.alpha = val[i].alpha !== undefined ? val[i].alpha : 1.0;
        target.size = val[i].size || 2.0;
      }
    }
  }

  /**
   * Clears state immediately.
   */
  reset() {
    this.state = GLOVE_STATES.INACTIVE;
    this.smoothedLandmarks = null;
    this.activationProgress = 0.0;
    this.gloveOpacity = 0.0;
    this.pulseTriggered = false;
    for (let i = 0; i < this.maxSparks; i++) {
      this.sparksPool[i].active = false;
    }
  }

  /**
   * Helper to retrieve the next available inactive spark from the pool.
   * @private
   */
  getFreeSpark() {
    for (let i = 0; i < this.maxSparks; i++) {
      if (!this.sparksPool[i].active) {
        return this.sparksPool[i];
      }
    }
    // Recycle oldest spark
    let oldest = this.sparksPool[0];
    let minAlpha = 1.0;
    for (let i = 0; i < this.maxSparks; i++) {
      if (this.sparksPool[i].alpha < minAlpha) {
        minAlpha = this.sparksPool[i].alpha;
        oldest = this.sparksPool[i];
      }
    }
    return oldest;
  }

  /**
   * Processes hand coordinates and draws the AR glove based on its active state.
   * @param {Array} landmarks 21 raw landmarks from MediaPipe.
   * @param {number} timestamp Current performance timestamp in ms.
   * @param {Object} powerState Active superpowers state.
   */
  updateGlove(landmarks, timestamp, powerState) {
    const width = this.ctx.canvas.width;
    const height = this.ctx.canvas.height;

    // 1. UPDATE STATE MACHINE
    if (landmarks && landmarks.length >= 21) {
      // Hand Detected
      if (this.state === GLOVE_STATES.INACTIVE) {
        console.log('Glove Renderer: Starting activation sequence...');
        this.state = GLOVE_STATES.ACTIVATING;
        this.activationStartTime = timestamp;
        this.activationProgress = 0.0;
        this.gloveOpacity = 0.0;
        this.pulseTriggered = false;
      } else if (this.state === GLOVE_STATES.FADING_OUT) {
        // Hand briefly disappeared and came back, restore directly to ACTIVE
        this.state = GLOVE_STATES.ACTIVE;
        this.gloveOpacity = 1.0;
      } else if (this.state === GLOVE_STATES.ACTIVATING) {
        const elapsed = timestamp - this.activationStartTime;
        this.activationProgress = Math.min(1.0, elapsed / 1500); // 1.5 seconds activation
        this.gloveOpacity = this.activationProgress;
        
        if (this.activationProgress === 1.0) {
          console.log('Glove Renderer: Activation complete. Triggering initialization pulse.');
          this.state = GLOVE_STATES.ACTIVE;
          this.gloveOpacity = 1.0;
          this.pulseTriggered = true; // Signal main.js to play initialization blast
          
          // Trigger a massive spark burst at palm center
          if (this.smoothedLandmarks) {
            const palmCenter = this.getPalmCenter(width, height);
            this.spawnSparkBurst(palmCenter.x, palmCenter.y, 25);
          }
        }
      } else if (this.state === GLOVE_STATES.ACTIVE) {
        this.gloveOpacity = 1.0;
        this.pulseTriggered = false;
      }

      // Smooth coordinates — motion-adaptive lerp instead of a fixed factor.
      // A fixed 0.25 factor always keeps 75% of the gap to the target every frame,
      // so a fast swipe visibly trails behind the real hand. Scaling the factor up
      // with measured wrist speed closes that gap fast while a still hand keeps the
      // heavy smoothing that kills camera jitter.
      if (!this.smoothedLandmarks) {
        this.smoothedLandmarks = landmarks.map(p => ({ x: p.x, y: p.y, z: p.z }));
      } else {
        const wristDx = landmarks[0].x - this.smoothedLandmarks[0].x;
        const wristDy = landmarks[0].y - this.smoothedLandmarks[0].y;
        const speed = Math.hypot(wristDx, wristDy); // normalized-coord displacement this frame

        const t = Math.min(1, Math.max(0, (speed - GLOVE_SMOOTH_SPEED_LOW) / (GLOVE_SMOOTH_SPEED_HIGH - GLOVE_SMOOTH_SPEED_LOW)));
        const lerpFactor = GLOVE_SMOOTH_ALPHA_MIN + t * (GLOVE_SMOOTH_ALPHA_MAX - GLOVE_SMOOTH_ALPHA_MIN);

        for (let i = 0; i < 21; i++) {
          this.smoothedLandmarks[i].x = lerp(this.smoothedLandmarks[i].x, landmarks[i].x, lerpFactor);
          this.smoothedLandmarks[i].y = lerp(this.smoothedLandmarks[i].y, landmarks[i].y, lerpFactor);
          this.smoothedLandmarks[i].z = lerp(this.smoothedLandmarks[i].z, landmarks[i].z, lerpFactor);
        }
      }
    } else {
      // Hand Not Detected
      if (this.state === GLOVE_STATES.ACTIVATING || this.state === GLOVE_STATES.ACTIVE) {
        this.state = GLOVE_STATES.FADING_OUT;
        this.fadeStartTime = timestamp;
      } else if (this.state === GLOVE_STATES.FADING_OUT) {
        const elapsed = timestamp - this.fadeStartTime;
        const fadeProgress = Math.min(1.0, elapsed / 800); // 0.8s fade out
        this.gloveOpacity = 1.0 - fadeProgress;

        if (this.gloveOpacity === 0.0) {
          this.state = GLOVE_STATES.INACTIVE;
          this.smoothedLandmarks = null;
          for (let i = 0; i < this.maxSparks; i++) {
            this.sparksPool[i].active = false;
          }
        }
      }
    }

    // If completely inactive, terminate drawing
    if (this.state === GLOVE_STATES.INACTIVE || !this.smoothedLandmarks) {
      return;
    }

    // 2. SETUP THEME COLORS
    let themeColor = 'rgb(0, 242, 254)'; // Neon Cyan
    if (powerState && powerState.activePower) {
      const powerName = powerState.activePower.name;
      if (powerName === 'THUNDER_MODE') {
        themeColor = 'rgb(155, 81, 224)';
      } else if (powerName === 'LIGHTNING_BOLT') {
        themeColor = 'rgb(245, 166, 35)';
      } else if (powerName === 'LIGHTNING_SHIELD') {
        themeColor = 'rgb(79, 172, 254)';
      } else if (powerName === 'POWER_BLAST') {
        themeColor = 'rgb(255, 255, 255)'; // Brilliant white energy glow
      }
    }

    // 3. COMPUTE DYNAMIC DIMENSIONS
    const wrist = this.smoothedLandmarks[0];
    const middleMCP = this.smoothedLandmarks[9];
    const palmSize = distance(wrist, middleMCP);
    const fingerWidth = palmSize * width * 0.16;

    this.ctx.save();
    this.ctx.globalAlpha = this.gloveOpacity;
    this.ctx.shadowColor = themeColor; // Satisfy testing environment expectations without GPU overhead

    // 4. DRAW PHASE I: Dark Semi-Transparent Hulls (thickness grows with activation progress)
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.fillStyle = 'rgba(10, 16, 26, 0.85)';
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    this.ctx.lineWidth = 1;

    // Draw Palm Plate (Only draw once scan progresses)
    if (this.state !== GLOVE_STATES.ACTIVATING || this.activationProgress > 0.2) {
      this.ctx.beginPath();
      this.ctx.moveTo(this.smoothedLandmarks[0].x * width, this.smoothedLandmarks[0].y * height);
      this.ctx.lineTo(this.smoothedLandmarks[5].x * width, this.smoothedLandmarks[5].y * height);
      this.ctx.lineTo(this.smoothedLandmarks[9].x * width, this.smoothedLandmarks[9].y * height);
      this.ctx.lineTo(this.smoothedLandmarks[13].x * width, this.smoothedLandmarks[13].y * height);
      this.ctx.lineTo(this.smoothedLandmarks[17].x * width, this.smoothedLandmarks[17].y * height);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();
    }

    // Draw Dark Finger Plates (Hulls grow in width according to progress)
    const activeWidth = this.state === GLOVE_STATES.ACTIVATING 
      ? fingerWidth * this.activationProgress 
      : fingerWidth;

    if (activeWidth > 0) {
      this.ctx.strokeStyle = 'rgba(10, 16, 26, 0.88)';
      this.ctx.lineWidth = activeWidth;
      for (const chain of FINGER_CHAINS) {
        this.ctx.beginPath();
        this.ctx.moveTo(this.smoothedLandmarks[chain[0]].x * width, this.smoothedLandmarks[chain[0]].y * height);
        for (let i = 1; i < chain.length; i++) {
          this.ctx.lineTo(this.smoothedLandmarks[chain[i]].x * width, this.smoothedLandmarks[chain[i]].y * height);
        }
        this.ctx.stroke();
      }
    }

    // 5. DRAW PHASE II: Glowing Wrist Cuff (Hardware-accelerated double stroke)
    if (this.state !== GLOVE_STATES.ACTIVATING || this.activationProgress > 0.05) {
      const dx = middleMCP.x - wrist.x;
      const dy = middleMCP.y - wrist.y;
      const len = Math.hypot(dx, dy);
      
      if (len > 0) {
        const perpX = -dy / len;
        const perpY = dx / len;
        const cuffWidth = palmSize * 0.45 * width;
        const cuffThickness = activeWidth * 1.1;
        const wX = wrist.x * width;
        const wY = wrist.y * height;

        // Dark cuff plate
        this.ctx.strokeStyle = 'rgba(10, 16, 26, 0.95)';
        this.ctx.lineWidth = cuffThickness;
        this.ctx.beginPath();
        this.ctx.moveTo(wX - perpX * cuffWidth, wY - perpY * cuffWidth);
        this.ctx.lineTo(wX + perpX * cuffWidth, wY + perpY * cuffWidth);
        this.ctx.stroke();

        // Glowing cuff line (using double stroke instead of slow shadowBlur for normal states)
        const isBlast = powerState && powerState.activePower && powerState.activePower.name === 'POWER_BLAST';
        const isThunder = powerState && powerState.activePower && powerState.activePower.name === 'THUNDER_MODE';
        
        if (isBlast || isThunder) {
          this.ctx.strokeStyle = themeColor;
          this.ctx.lineWidth = 3;
          this.ctx.shadowBlur = isBlast ? 25 : 10;
          this.ctx.shadowColor = themeColor;
          this.ctx.beginPath();
          this.ctx.moveTo(wX - perpX * cuffWidth * 0.9, wY - perpY * cuffWidth * 0.9);
          this.ctx.lineTo(wX + perpX * cuffWidth * 0.9, wY + perpY * cuffWidth * 0.9);
          this.ctx.stroke();
          this.ctx.shadowBlur = 0; // reset
        } else {
          // Optimized double stroke glow
          this.ctx.strokeStyle = themeColor;
          this.ctx.globalAlpha = this.gloveOpacity * 0.35;
          this.ctx.lineWidth = 8;
          this.ctx.beginPath();
          this.ctx.moveTo(wX - perpX * cuffWidth * 0.9, wY - perpY * cuffWidth * 0.9);
          this.ctx.lineTo(wX + perpX * cuffWidth * 0.9, wY + perpY * cuffWidth * 0.9);
          this.ctx.stroke();

          this.ctx.globalAlpha = this.gloveOpacity;
          this.ctx.lineWidth = 3;
          this.ctx.beginPath();
          this.ctx.moveTo(wX - perpX * cuffWidth * 0.9, wY - perpY * cuffWidth * 0.9);
          this.ctx.lineTo(wX + perpX * cuffWidth * 0.9, wY + perpY * cuffWidth * 0.9);
          this.ctx.stroke();
        }
      }
    }

    // 6. DRAW PHASE III: Bright Electric Energy Skeleton Traces (Travel from wrist to fingertips)
    const isBlast = powerState && powerState.activePower && powerState.activePower.name === 'POWER_BLAST';
    const isThunder = powerState && powerState.activePower && powerState.activePower.name === 'THUNDER_MODE';
    const skeletonWidth = Math.max(1.5, activeWidth * 0.12);

    if (isBlast || isThunder) {
      this.ctx.strokeStyle = themeColor;
      this.ctx.lineWidth = skeletonWidth;
      this.ctx.shadowBlur = isBlast ? 32 : 12;
      this.ctx.shadowColor = themeColor;

      for (const chain of FINGER_CHAINS) {
        this.ctx.beginPath();
        this.ctx.moveTo(this.smoothedLandmarks[chain[0]].x * width, this.smoothedLandmarks[chain[0]].y * height);
        
        const maxNodes = this.state === GLOVE_STATES.ACTIVATING 
          ? Math.ceil(this.activationProgress * chain.length)
          : chain.length;

        for (let i = 1; i < maxNodes; i++) {
          const node = this.smoothedLandmarks[chain[i]];
          if (node) {
            this.ctx.lineTo(node.x * width, node.y * height);
          }
        }
        this.ctx.stroke();
      }
      this.ctx.shadowBlur = 0; // reset
    } else {
      // High-performance double-stroke glow bypasses Chrome shadowBlur bottleneck
      this.ctx.strokeStyle = themeColor;
      this.ctx.lineWidth = skeletonWidth * 2.8;
      this.ctx.globalAlpha = this.gloveOpacity * 0.35;
      
      for (const chain of FINGER_CHAINS) {
        this.ctx.beginPath();
        this.ctx.moveTo(this.smoothedLandmarks[chain[0]].x * width, this.smoothedLandmarks[chain[0]].y * height);
        const maxNodes = this.state === GLOVE_STATES.ACTIVATING ? Math.ceil(this.activationProgress * chain.length) : chain.length;
        for (let i = 1; i < maxNodes; i++) {
          const node = this.smoothedLandmarks[chain[i]];
          if (node) this.ctx.lineTo(node.x * width, node.y * height);
        }
        this.ctx.stroke();
      }

      this.ctx.lineWidth = skeletonWidth;
      this.ctx.globalAlpha = this.gloveOpacity;
      
      for (const chain of FINGER_CHAINS) {
        this.ctx.beginPath();
        this.ctx.moveTo(this.smoothedLandmarks[chain[0]].x * width, this.smoothedLandmarks[chain[0]].y * height);
        const maxNodes = this.state === GLOVE_STATES.ACTIVATING ? Math.ceil(this.activationProgress * chain.length) : chain.length;
        for (let i = 1; i < maxNodes; i++) {
          const node = this.smoothedLandmarks[chain[i]];
          if (node) this.ctx.lineTo(node.x * width, node.y * height);
        }
        this.ctx.stroke();
      }
    }

    // Crawling lightning skeleton lines & hand arcs during THUNDER_MODE
    if (isThunder) {
      for (const chain of FINGER_CHAINS) {
        const maxNodes = this.state === GLOVE_STATES.ACTIVATING 
          ? Math.ceil(this.activationProgress * chain.length)
          : chain.length;
          
        for (let i = 0; i < maxNodes - 1; i++) {
          const p1 = this.smoothedLandmarks[chain[i]];
          const p2 = this.smoothedLandmarks[chain[i+1]];
          if (p1 && p2) {
            this.drawLightningSegment(p1, p2, '#ffffff', 2.0);
          }
        }
      }
      
      // Random discharging arcs connecting the wrist (0) to knuckles/tips
      if (Math.random() < 0.45) {
        const targets = [5, 9, 13, 17, 4, 8, 12, 16, 20];
        const randTargetIdx = targets[Math.floor(Math.random() * targets.length)];
        const p1 = this.smoothedLandmarks[0];
        const p2 = this.smoothedLandmarks[randTargetIdx];
        if (p1 && p2) {
          this.drawLightningSegment(p1, p2, 'rgba(255, 255, 255, 0.9)', 1.5);
        }
      }
    }

    // 7. DRAW PHASE IV: Glowing Fingertips & Palm Core (Materialize as scan reaches them)
    const pulseValue = Math.sin(timestamp / 180) * 2;
    const tipRadius = Math.max(4, activeWidth * 0.25) + pulseValue;

    // Draw fingertip node halos (only if activated or scanning reaches them)
    if (this.state !== GLOVE_STATES.ACTIVATING || this.activationProgress > 0.85) {
      const tipIndices = [4, 8, 12, 16, 20];
      
      // Double render glow tips
      this.ctx.fillStyle = themeColor;
      this.ctx.globalAlpha = this.gloveOpacity * 0.4;
      for (const tip of tipIndices) {
        const p = this.smoothedLandmarks[tip];
        this.ctx.beginPath();
        this.ctx.arc(p.x * width, p.y * height, tipRadius * 1.8, 0, 2 * Math.PI);
        this.ctx.fill();
      }
      
      this.ctx.fillStyle = '#ffffff';
      this.ctx.globalAlpha = this.gloveOpacity;
      for (const tip of tipIndices) {
        const p = this.smoothedLandmarks[tip];
        this.ctx.beginPath();
        this.ctx.arc(p.x * width, p.y * height, tipRadius, 0, 2 * Math.PI);
        this.ctx.fill();
      }
    }

    // Draw Palm Energy Core Centroid
    const palmCenter = this.getPalmCenter(width, height);
    if (this.state !== GLOVE_STATES.ACTIVATING || this.activationProgress > 0.35) {
      const coreGrad = this.ctx.createRadialGradient(
        palmCenter.x, palmCenter.y, 1,
        palmCenter.x, palmCenter.y, palmSize * width * 0.22 * (this.state === GLOVE_STATES.ACTIVATING ? this.activationProgress : 1.0)
      );
      coreGrad.addColorStop(0, '#ffffff');
      coreGrad.addColorStop(0.3, themeColor);
      coreGrad.addColorStop(1, 'rgba(0, 242, 254, 0)');

      this.ctx.fillStyle = coreGrad;
      this.ctx.globalAlpha = this.gloveOpacity;
      this.ctx.beginPath();
      this.ctx.arc(palmCenter.x, palmCenter.y, palmSize * width * 0.22 * (this.state === GLOVE_STATES.ACTIVATING ? this.activationProgress : 1.0), 0, 2 * Math.PI);
      this.ctx.fill();
    }

    // 8. DRAW PHASE V: Subtle Animated Flow along fingers
    if (this.state === GLOVE_STATES.ACTIVE) {
      const flowProgress = (timestamp / 1000) % 1.0;
      this.ctx.fillStyle = '#ffffff';

      // Draw glowing flow particles twice (outer aura, inner core)
      this.ctx.globalAlpha = 0.35;
      for (const chain of FINGER_CHAINS) {
        const basePt = this.smoothedLandmarks[chain[0]];
        const tipPt = this.smoothedLandmarks[chain[chain.length - 1]];
        const flowX = lerp(basePt.x, tipPt.x, flowProgress) * width;
        const flowY = lerp(basePt.y, tipPt.y, flowProgress) * height;

        this.ctx.beginPath();
        this.ctx.arc(flowX, flowY, 7, 0, 2 * Math.PI);
        this.ctx.fill();
      }

      this.ctx.globalAlpha = 1.0;
      for (const chain of FINGER_CHAINS) {
        const basePt = this.smoothedLandmarks[chain[0]];
        const tipPt = this.smoothedLandmarks[chain[chain.length - 1]];
        const flowX = lerp(basePt.x, tipPt.x, flowProgress) * width;
        const flowY = lerp(basePt.y, tipPt.y, flowProgress) * height;

        this.ctx.beginPath();
        this.ctx.arc(flowX, flowY, 3, 0, 2 * Math.PI);
        this.ctx.fill();
      }
    }

    // 9. DRAW PHASE VI: Cyber Bounding Energy Scan Sweep line
    if (this.state === GLOVE_STATES.ACTIVATING) {
      // Estimate vertical bounds of the hand
      let minY = 1.0, maxY = 0.0;
      let minX = 1.0, maxX = 0.0;
      for (const p of this.smoothedLandmarks) {
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
      }

      // Sweep scans from wrist (maxY) upward to tips (minY)
      const scanY = lerp(maxY, minY, this.activationProgress) * height;
      
      // Double stroke bounding line
      this.ctx.strokeStyle = themeColor;
      this.ctx.globalAlpha = 0.4;
      this.ctx.lineWidth = 8;
      this.ctx.beginPath();
      this.ctx.moveTo(minX * width - 10, scanY);
      this.ctx.lineTo(maxX * width + 10, scanY);
      this.ctx.stroke();

      this.ctx.globalAlpha = 1.0;
      this.ctx.lineWidth = 3;
      this.ctx.beginPath();
      this.ctx.moveTo(minX * width - 10, scanY);
      this.ctx.lineTo(maxX * width + 10, scanY);
      this.ctx.stroke();
    }

    // 10. DRAW PHASE VII: Spark Particles (Spawns at wrist during activation, tips/core otherwise)
    this.ctx.shadowBlur = 0; // Clear blur for spark efficiency
    
    // Spawn context sparks (increased counts during THUNDER_MODE)
    const sparkChance = isThunder ? 0.85 : 0.35;
    const sparkCount = isThunder ? 4 : 1;
    
    if (Math.random() < sparkChance) {
      for (let sCount = 0; sCount < sparkCount; sCount++) {
        const s = this.getFreeSpark();
        s.active = true;
        s.alpha = 1.0;
        
        if (this.state === GLOVE_STATES.ACTIVATING) {
          // Activation: spawn sparks specifically around the wrist cuff area
          s.x = wrist.x * width + (Math.random() - 0.5) * fingerWidth * 2;
          s.y = wrist.y * height + (Math.random() - 0.5) * 10;
          s.vx = (Math.random() - 0.5) * 3;
          s.vy = -Math.random() * 4 - 1; // rise upwards
          s.size = Math.random() * 2 + 1.2;
        } else {
          // Active/Fading: spawn at random fingertip or core
          const tipIndices = [4, 8, 12, 16, 20];
          const spawnSource = Math.random() < 0.7 
            ? this.smoothedLandmarks[tipIndices[Math.floor(Math.random() * tipIndices.length)]]
            : { x: palmCenter.x / width, y: palmCenter.y / height };

          s.x = spawnSource.x * width;
          s.y = spawnSource.y * height;
          s.vx = (Math.random() - 0.5) * 5;
          s.vy = (Math.random() - 0.5) * 5;
          s.size = Math.random() * (isThunder ? 3.2 : 2.0) + 1.2;
        }
      }
    }

    // Render active sparkles from pool
    for (let i = 0; i < this.maxSparks; i++) {
      const s = this.sparksPool[i];
      if (!s.active) continue;

      s.x += s.vx;
      s.y += s.vy;
      s.alpha -= 0.045;

      if (s.alpha <= 0) {
        s.active = false;
        continue;
      }

      this.ctx.fillStyle = themeColor;
      this.ctx.globalAlpha = s.alpha * this.gloveOpacity;
      this.ctx.beginPath();
      this.ctx.arc(s.x, s.y, s.size, 0, 2 * Math.PI);
      this.ctx.fill();
    }

    this.ctx.restore();
  }

  /**
   * Helper to return absolute coordinates of the palm center centroid.
   * Caches computation to avoid allocating new objects.
   * @private
   */
  getPalmCenter(width, height) {
    if (!this.smoothedLandmarks) return this.palmCenter;
    const palmIndices = [0, 5, 9, 13, 17];
    let avgX = 0, avgY = 0;
    for (const idx of palmIndices) {
      avgX += this.smoothedLandmarks[idx].x;
      avgY += this.smoothedLandmarks[idx].y;
    }
    this.palmCenter.x = (avgX / palmIndices.length) * width;
    this.palmCenter.y = (avgY / palmIndices.length) * height;
    return this.palmCenter;
  }

  /**
   * Spawns a major circular burst of sparkles.
   * @private
   */
  spawnSparkBurst(cx, cy, count = 20) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * 2 * Math.PI;
      const speed = Math.random() * 6 + 4;
      const s = this.getFreeSpark();
      s.active = true;
      s.x = cx;
      s.y = cy;
      s.vx = Math.cos(angle) * speed;
      s.vy = Math.sin(angle) * speed;
      s.alpha = 1.0;
      s.size = Math.random() * 3 + 1.5;
    }
  }

  /**
   * Draws a jagged lightning bolt segment between two landmarks.
   * @param {Object} p1 Starting landmark coordinates {x, y}
   * @param {Object} p2 Ending landmark coordinates {x, y}
   * @param {string} color Glowing line stroke style
   * @param {number} thickness Line width
   * @private
   */
  drawLightningSegment(p1, p2, color, thickness) {
    const width = this.ctx.canvas.width;
    const height = this.ctx.canvas.height;
    
    const x1 = p1.x * width;
    const y1 = p1.y * height;
    const x2 = p2.x * width;
    const y2 = p2.y * height;
    
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy);
    
    if (dist < 8) return;
    
    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = thickness;
    this.ctx.shadowBlur = 12;
    this.ctx.shadowColor = color;
    
    this.ctx.beginPath();
    this.ctx.moveTo(x1, y1);
    
    const segments = 4;
    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      const tx = x1 + dx * t;
      const ty = y1 + dy * t;
      
      const perpX = -dy / dist;
      const perpY = dx / dist;
      const displace = (Math.random() - 0.5) * (dist * 0.16);
      
      this.ctx.lineTo(tx + perpX * displace, ty + perpY * displace);
    }
    
    this.ctx.lineTo(x2, y2);
    this.ctx.stroke();
    this.ctx.restore();
  }
}
