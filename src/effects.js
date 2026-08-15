/**
 * Effects Module for MINNAL-X
 * Generates custom visual effects like lightning arcs, energy sparks, and glows.
 */

export class VisualEffects {
  constructor(canvasContext) {
    this.ctx = canvasContext;
    this.maxParticles = 300;
    this.particlePool = Array.from({ length: this.maxParticles }, () => ({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      alpha: 0,
      color: '',
      size: 0,
      implode: false,
      targetX: 0,
      targetY: 0
    }));
    this.activeBlasts = [];
    this.shakeOffset = { x: 0, y: 0 };
    this.thunderFlashTime = null;
  }

  /**
   * Helper to retrieve the next available inactive particle from the pool.
   * @private
   */
  getFreeParticle() {
    for (let i = 0; i < this.maxParticles; i++) {
      if (!this.particlePool[i].active) {
        return this.particlePool[i];
      }
    }
    // Fallback: recycle oldest (lowest alpha) particle
    let oldest = this.particlePool[0];
    let minAlpha = 1.0;
    for (let i = 0; i < this.maxParticles; i++) {
      if (this.particlePool[i].alpha < minAlpha) {
        minAlpha = this.particlePool[i].alpha;
        oldest = this.particlePool[i];
      }
    }
    return oldest;
  }

  /**
   * Spawns energy particles at a specific position.
   * @param {number} x 
   * @param {number} y 
   * @param {string} color 
   */
  spawnSparks(x, y, color = '#00f2fe') {
    for (let i = 0; i < 5; i++) {
      const p = this.getFreeParticle();
      p.active = true;
      p.x = x;
      p.y = y;
      p.vx = (Math.random() - 0.5) * 6;
      p.vy = (Math.random() - 0.5) * 6;
      p.alpha = 1.0;
      p.color = color;
      p.size = Math.random() * 3 + 1;
      p.implode = false;
    }
  }

  /**
   * Triggers the visual sequence for a Power Blast.
   * @param {Object} center Centroid coordinates {x, y}
   * @param {number} radius Hand size radius
   * @param {number} timestamp Current performance timestamp in ms
   */
  triggerBlast(center, radius, timestamp) {
    this.activeBlasts.push({
      center: { ...center },
      radius: radius || 60,
      startTime: timestamp,
      duration: 1000, // 1 second total
      shakeIntensity: 18,
      particlesSpawned: false
    });
  }

  /**
   * Updates and draws active effects.
   * @param {number} timestamp Current performance timestamp in ms
   */
  updateAndDraw(timestamp = performance.now()) {
    // 1. Update and draw active particles from pool (no slow shadowBlur or save/restore)
    for (let i = 0; i < this.maxParticles; i++) {
      const p = this.particlePool[i];
      if (!p.active) continue;

      p.x += p.vx;
      p.y += p.vy;
      p.alpha -= 0.025; // Snappier fading
      
      if (p.alpha <= 0) {
        p.active = false;
        continue;
      }
      
      // If particle is imploding, check if it reached target center
      if (p.implode) {
        const dx = p.targetX - p.x;
        const dy = p.targetY - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 8) {
          p.active = false;
          continue;
        }
      }
      
      // High-performance double-render to simulate glow without slow ctx.shadowBlur
      this.ctx.fillStyle = p.color;
      
      // Outer halo
      this.ctx.globalAlpha = p.alpha * 0.35;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.size * 2.2, 0, 2 * Math.PI);
      this.ctx.fill();
      
      // Core center
      this.ctx.globalAlpha = p.alpha;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.size, 0, 2 * Math.PI);
      this.ctx.fill();
    }
    this.ctx.globalAlpha = 1.0; // Reset global alpha

    // 2. Update and draw active blasts
    const width = this.ctx.canvas.width;
    const height = this.ctx.canvas.height;
    this.shakeOffset = { x: 0, y: 0 };

    for (let i = this.activeBlasts.length - 1; i >= 0; i--) {
      const b = this.activeBlasts[i];
      const elapsed = timestamp - b.startTime;
      const t = elapsed / b.duration;

      if (t >= 1.0) {
        this.activeBlasts.splice(i, 1);
        continue;
      }

      // Stage 1 (t < 0.4): Compression & Glove Brightness
      if (t < 0.4) {
        const compressProgress = t / 0.4;
        const sphereRadius = b.radius * (2.0 - compressProgress * 1.5);
        const glowOpacity = compressProgress * 0.8;

        // Draw contracting glowing sphere
        const grad = this.ctx.createRadialGradient(
          b.center.x, b.center.y, 1,
          b.center.x, b.center.y, sphereRadius
        );
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.3, 'rgba(0, 242, 254, 0.9)');
        grad.addColorStop(1, 'rgba(0, 242, 254, 0)');

        this.ctx.save();
        this.ctx.globalAlpha = glowOpacity;
        this.ctx.fillStyle = grad;
        this.ctx.beginPath();
        this.ctx.arc(b.center.x, b.center.y, sphereRadius, 0, 2 * Math.PI);
        this.ctx.fill();
        this.ctx.restore();

        // Spawn imploding sparks moving toward centroid center
        if (Math.random() < 0.65) {
          const angle = Math.random() * 2 * Math.PI;
          const dist = b.radius * (2.5 - Math.random() * 1.2);
          const px = b.center.x + Math.cos(angle) * dist;
          const py = b.center.y + Math.sin(angle) * dist;
          const speed = dist / 12; // reach center in ~12 frames
          
          const p = this.getFreeParticle();
          p.active = true;
          p.x = px;
          p.y = py;
          p.vx = -Math.cos(angle) * speed;
          p.vy = -Math.sin(angle) * speed;
          p.alpha = 1.0;
          p.color = '#00f2fe';
          p.size = Math.random() * 2.5 + 1.2;
          p.implode = true;
          p.targetX = b.center.x;
          p.targetY = b.center.y;
        }
      } 
      // Stage 2 (t >= 0.4): Flash & Shockwave
      else {
        const shockProgress = (t - 0.4) / 0.6;
        const shockRadius = b.radius * 1.0 + shockProgress * b.radius * 6.0;
        const shockOpacity = 1.0 - shockProgress;

        // Draw Expanding Shockwave Ring
        this.ctx.save();
        this.ctx.strokeStyle = `rgba(0, 242, 254, ${shockOpacity})`;
        this.ctx.lineWidth = 6 * (1.0 - shockProgress);
        this.ctx.shadowBlur = 18;
        this.ctx.shadowColor = '#00f2fe';
        this.ctx.beginPath();
        this.ctx.arc(b.center.x, b.center.y, shockRadius, 0, 2 * Math.PI);
        this.ctx.stroke();
        
        // Draw second concentric ring
        if (shockProgress < 0.6) {
          this.ctx.strokeStyle = `rgba(255, 255, 255, ${shockOpacity * 0.7})`;
          this.ctx.lineWidth = 3;
          this.ctx.beginPath();
          this.ctx.arc(b.center.x, b.center.y, shockRadius * 0.7, 0, 2 * Math.PI);
          this.ctx.stroke();
        }
        this.ctx.restore();

        // Draw full screen white/cyan flash at peak (t = 0.4 to 0.55)
        if (t < 0.55) {
          const flashOpacity = (1.0 - (t - 0.4) / 0.15) * 0.75;
          this.ctx.save();
          this.ctx.fillStyle = `rgba(255, 255, 255, ${flashOpacity})`;
          this.ctx.fillRect(0, 0, width, height);
          this.ctx.restore();
        }

        // Spawn outward blast particles once at shockwave initiation
        if (!b.particlesSpawned) {
          const spawnCount = 25; // Optimized from 35 to 25
          for (let i = 0; i < spawnCount; i++) {
            const angle = (i / spawnCount) * 2 * Math.PI + (Math.random() - 0.5) * 0.15;
            const speed = Math.random() * 9 + 6;
            
            const p = this.getFreeParticle();
            p.active = true;
            p.x = b.center.x;
            p.y = b.center.y;
            p.vx = Math.cos(angle) * speed;
            p.vy = Math.sin(angle) * speed;
            p.alpha = 1.0;
            p.color = '#ffffff';
            p.size = Math.random() * 3.5 + 1.5;
            p.implode = false;
          }
          b.particlesSpawned = true;
        }

        // Apply screen shake (vibrates more violently at start of Stage 2)
        if (t < 0.75) {
          const shakeProgress = (0.75 - t) / 0.35;
          const shakeAmt = b.shakeIntensity * shakeProgress;
          this.shakeOffset.x = (Math.random() - 0.5) * shakeAmt;
          this.shakeOffset.y = (Math.random() - 0.5) * shakeAmt;
        }
      }
    }

    // 3. Render cinematic lightning flash for THUNDER_MODE
    if (this.thunderFlashTime !== null) {
      const elapsed = timestamp - this.thunderFlashTime;
      if (elapsed < 600) {
        const flashOpacity = (1.0 - elapsed / 600) * 0.85;
        this.ctx.save();
        this.ctx.fillStyle = `rgba(255, 245, 220, ${flashOpacity})`;
        this.ctx.fillRect(0, 0, width, height);
        this.ctx.restore();
      } else {
        this.thunderFlashTime = null;
      }
    }
  }

  /**
   * Triggers the cinematic fullscreen lightning flash.
   * @param {number} timestamp
   */
  triggerThunderFlash(timestamp) {
    this.thunderFlashTime = timestamp;
  }

  /**
   * Draws a lightning bolt from start to end points.
   * @param {Object} start {x, y}
   * @param {Object} end {x, y}
   * @param {string} color 
   */
  drawLightning(start, end, color = '#00f2fe') {
    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = Math.random() * 2 + 1;
    this.ctx.shadowBlur = 15;
    this.ctx.shadowColor = color;
    
    this.ctx.beginPath();
    this.ctx.moveTo(start.x, start.y);
    
    // Divide the line into segments and displace middle vertices to simulate lightning jag
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.hypot(dx, dy);
    const segments = Math.max(3, Math.floor(distance / 20));
    
    let currentX = start.x;
    let currentY = start.y;
    
    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      const targetX = start.x + dx * t;
      const targetY = start.y + dy * t;
      
      // Add perpendicular displacement
      const perpX = -dy / distance;
      const perpY = dx / distance;
      const displacement = (Math.random() - 0.5) * 15;
      
      currentX = targetX + perpX * displacement;
      currentY = targetY + perpY * displacement;
      
      this.ctx.lineTo(currentX, currentY);
    }
    
    this.ctx.lineTo(end.x, end.y);
    this.ctx.stroke();
    this.ctx.restore();
  }

  /**
   * Renders the glowing lightning shield.
   * @param {Object} center Centroid coordinates {x, y}
   * @param {number} radius Base shield radius
   * @param {number} angle Rotation angle in radians
   * @param {number} opacity Global opacity for transitions [0.0, 1.0]
   */
  drawShield(center, radius, angle, opacity) {
    if (opacity <= 0 || !center) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = opacity;

    const pulse = Math.sin(performance.now() / 120) * 0.045;
    const activeRadius = radius * (1.0 + pulse);

    // 1. Draw Transparent Center & Bright Edge Gradient
    const gradient = ctx.createRadialGradient(
      center.x, center.y, activeRadius * 0.65,
      center.x, center.y, activeRadius
    );
    gradient.addColorStop(0, 'rgba(0, 242, 254, 0.0)');
    gradient.addColorStop(0.4, 'rgba(0, 242, 254, 0.15)');
    gradient.addColorStop(0.85, 'rgba(0, 242, 254, 0.35)');
    gradient.addColorStop(1.0, 'rgba(0, 242, 254, 0.85)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(center.x, center.y, activeRadius, 0, 2 * Math.PI);
    ctx.fill();

    // 2. Draw Outer Glowing Ring
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 3.5;
    ctx.shadowBlur = 22;
    ctx.shadowColor = '#00f2fe';
    ctx.beginPath();
    ctx.arc(center.x, center.y, activeRadius, 0, 2 * Math.PI);
    ctx.stroke();

    // 3. Draw Inner Concentric Pattern Rings
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.45)';
    ctx.lineWidth = 1;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(center.x, center.y, activeRadius * 0.82, 0, 2 * Math.PI);
    ctx.stroke();

    // 4. Draw Circumferential Electrical Arcs (Continuous Rotation)
    const arcCount = 4;
    const segmentsPerArc = 8;
    const arcSweep = Math.PI * 0.42; // Arc length in radians
    
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.0;
    ctx.shadowBlur = 14;
    ctx.shadowColor = '#00f2fe';

    for (let i = 0; i < arcCount; i++) {
      const baseAngle = angle + (i * (2 * Math.PI / arcCount));
      
      ctx.beginPath();
      let startAngle = baseAngle;
      let sx = center.x + Math.cos(startAngle) * activeRadius;
      let sy = center.y + Math.sin(startAngle) * activeRadius;
      ctx.moveTo(sx, sy);

      for (let j = 1; j <= segmentsPerArc; j++) {
        const t = j / segmentsPerArc;
        const currentAngle = baseAngle + t * arcSweep;
        
        // Add random jag deviation inward/outward
        const deviation = (Math.random() - 0.5) * 14;
        const arcRadius = activeRadius + deviation;
        
        const px = center.x + Math.cos(currentAngle) * arcRadius;
        const py = center.y + Math.sin(currentAngle) * arcRadius;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // 5. Spawn Shield Border Sparks
    if (Math.random() < 0.28) {
      const sparkAngle = Math.random() * 2 * Math.PI;
      const sx = center.x + Math.cos(sparkAngle) * activeRadius;
      const sy = center.y + Math.sin(sparkAngle) * activeRadius;
      this.spawnSparks(sx, sy, '#00f2fe');
    }

    ctx.restore();
  }
}
