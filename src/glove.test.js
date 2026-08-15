import { describe, it, expect, vi } from 'vitest';
import { EnergyGloveRenderer } from './glove.js';

// Helper function to create mock context
function createMockContext() {
  const strokeStyles = [];
  const shadowColors = [];
  
  const ctx = {
    canvas: { width: 640, height: 480 },
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    createRadialGradient: vi.fn(() => ({
      addColorStop: vi.fn(),
    })),
    lineCap: '',
    lineJoin: '',
    fillStyle: '',
    lineWidth: 0,
    shadowBlur: 0,
    globalAlpha: 1.0,
    strokeStyles,
    shadowColors,
  };

  Object.defineProperty(ctx, 'strokeStyle', {
    set(val) {
      strokeStyles.push(val);
      this._strokeStyle = val;
    },
    get() {
      return this._strokeStyle;
    }
  });

  Object.defineProperty(ctx, 'shadowColor', {
    set(val) {
      shadowColors.push(val);
      this._shadowColor = val;
    },
    get() {
      return this._shadowColor;
    }
  });

  return ctx;
}

// Helper to generate mock landmarks
function createMockLandmarks() {
  const landmarks = [];
  for (let i = 0; i < 21; i++) {
    landmarks.push({ x: 0.5 + i * 0.01, y: 0.5 + i * 0.01, z: 0.0 });
  }
  return landmarks;
}

describe('EnergyGloveRenderer', () => {
  it('should initialize with correct default properties', () => {
    const ctx = createMockContext();
    const renderer = new EnergyGloveRenderer(ctx);

    expect(renderer.ctx).toBe(ctx);
    expect(renderer.state).toBe('INACTIVE');
    expect(renderer.smoothedLandmarks).toBeNull();
    expect(renderer.sparks).toEqual([]);
    expect(renderer.activationProgress).toBe(0.0);
    expect(renderer.gloveOpacity).toBe(0.0);
    expect(renderer.pulseTriggered).toBe(false);
  });

  it('should reset properties correctly on reset()', () => {
    const ctx = createMockContext();
    const renderer = new EnergyGloveRenderer(ctx);

    renderer.state = 'ACTIVE';
    renderer.smoothedLandmarks = createMockLandmarks();
    renderer.sparks = [{ x: 1, y: 2 }];
    renderer.activationProgress = 1.0;
    renderer.gloveOpacity = 1.0;
    renderer.pulseTriggered = true;

    renderer.reset();

    expect(renderer.state).toBe('INACTIVE');
    expect(renderer.smoothedLandmarks).toBeNull();
    expect(renderer.sparks).toEqual([]);
    expect(renderer.activationProgress).toBe(0.0);
    expect(renderer.gloveOpacity).toBe(0.0);
    expect(renderer.pulseTriggered).toBe(false);
  });

  it('should transition state from INACTIVE to ACTIVATING when hand is detected', () => {
    const ctx = createMockContext();
    const renderer = new EnergyGloveRenderer(ctx);
    const landmarks = createMockLandmarks();

    renderer.updateGlove(landmarks, 1000, null);

    expect(renderer.state).toBe('ACTIVATING');
    expect(renderer.activationStartTime).toBe(1000);
    expect(renderer.activationProgress).toBe(0.0);
    expect(renderer.gloveOpacity).toBe(0.0);
    expect(renderer.pulseTriggered).toBe(false);
  });

  it('should progress activation and transition to ACTIVE after 1.5 seconds', () => {
    const ctx = createMockContext();
    const renderer = new EnergyGloveRenderer(ctx);
    const landmarks = createMockLandmarks();

    // 1st frame: detects hand and transitions to ACTIVATING
    renderer.updateGlove(landmarks, 1000, null);
    expect(renderer.state).toBe('ACTIVATING');

    // 2nd frame: 750ms later (halfway activated)
    renderer.updateGlove(landmarks, 1750, null);
    expect(renderer.state).toBe('ACTIVATING');
    expect(renderer.activationProgress).toBeCloseTo(0.5);
    expect(renderer.gloveOpacity).toBeCloseTo(0.5);
    expect(renderer.pulseTriggered).toBe(false);

    // 3rd frame: 1500ms after start (fully activated)
    renderer.updateGlove(landmarks, 2500, null);
    expect(renderer.state).toBe('ACTIVE');
    expect(renderer.activationProgress).toBe(1.0);
    expect(renderer.gloveOpacity).toBe(1.0);
    expect(renderer.pulseTriggered).toBe(true);
  });

  it('should transition to FADING_OUT when tracking is lost, and decay to INACTIVE', () => {
    const ctx = createMockContext();
    const renderer = new EnergyGloveRenderer(ctx);
    const landmarks = createMockLandmarks();

    // Activate the glove
    renderer.updateGlove(landmarks, 1000, null);
    renderer.updateGlove(landmarks, 2500, null);
    expect(renderer.state).toBe('ACTIVE');

    // Lost tracking on next frame
    renderer.updateGlove(null, 3000, null);
    expect(renderer.state).toBe('FADING_OUT');
    expect(renderer.fadeStartTime).toBe(3000);

    // Halfway faded out (400ms elapsed out of 800ms)
    renderer.updateGlove(null, 3400, null);
    expect(renderer.state).toBe('FADING_OUT');
    expect(renderer.gloveOpacity).toBeCloseTo(0.5);

    // Fully faded out (800ms elapsed)
    renderer.updateGlove(null, 3800, null);
    expect(renderer.state).toBe('INACTIVE');
    expect(renderer.smoothedLandmarks).toBeNull();
    expect(renderer.sparks).toEqual([]);
  });

  it('should restore state directly to ACTIVE if hand returns during FADING_OUT', () => {
    const ctx = createMockContext();
    const renderer = new EnergyGloveRenderer(ctx);
    const landmarks = createMockLandmarks();

    // Activate and then lose hand
    renderer.updateGlove(landmarks, 1000, null);
    renderer.updateGlove(landmarks, 2500, null);
    renderer.updateGlove(null, 3000, null);
    expect(renderer.state).toBe('FADING_OUT');

    // Hand returns
    renderer.updateGlove(landmarks, 3400, null);
    expect(renderer.state).toBe('ACTIVE');
    expect(renderer.gloveOpacity).toBe(1.0);
  });

  it('should smooth coordinates using lerp over updates', () => {
    const ctx = createMockContext();
    const renderer = new EnergyGloveRenderer(ctx);

    const landmarks1 = createMockLandmarks(); // all at 0.5
    const landmarks2 = createMockLandmarks().map(p => ({ x: p.x + 0.1, y: p.y + 0.1, z: p.z + 0.1 }));

    renderer.updateGlove(landmarks1, 1000, null);
    // On the first frame, smoothedLandmarks should match the input landmarks
    expect(renderer.smoothedLandmarks[0].x).toBe(landmarks1[0].x);

    renderer.updateGlove(landmarks2, 1100, null);
    // Smoothing is motion-adaptive: a 0.1-unit jump (well above the "fast" speed
    // threshold) uses the max lerp factor of 0.85 to avoid trailing behind a fast move.
    // start + 0.85 * (end - start) => 0.5 + 0.85 * (0.6 - 0.5) => 0.585
    expect(renderer.smoothedLandmarks[0].x).toBeCloseTo(0.585);
  });

  it('should smooth gently when the hand barely moves (jitter suppression)', () => {
    const ctx = createMockContext();
    const renderer = new EnergyGloveRenderer(ctx);

    const landmarks1 = createMockLandmarks(); // all at 0.5
    // Tiny 0.002 jitter — below the "still" speed threshold, should use the min lerp factor.
    const landmarks2 = createMockLandmarks().map(p => ({ x: p.x + 0.002, y: p.y, z: p.z }));

    renderer.updateGlove(landmarks1, 1000, null);
    renderer.updateGlove(landmarks2, 1100, null);
    // start + 0.25 * (end - start) => 0.5 + 0.25 * (0.502 - 0.5) => 0.5005
    expect(renderer.smoothedLandmarks[0].x).toBeCloseTo(0.5005, 4);
  });

  it('should select theme colors depending on the powerState', () => {
    const ctx = createMockContext();
    const renderer = new EnergyGloveRenderer(ctx);
    const landmarks = createMockLandmarks();

    renderer.updateGlove(landmarks, 1000, null);
    renderer.updateGlove(landmarks, 2500, null); // Active

    // Default color (Cyan)
    renderer.updateGlove(landmarks, 2600, { activePower: null });
    expect(ctx.shadowColors).toContain('rgb(0, 242, 254)');

    // PLASMA_BEAM / THUNDER_MODE (Purple)
    renderer.updateGlove(landmarks, 2700, { activePower: { name: 'THUNDER_MODE' } });
    expect(ctx.shadowColors).toContain('rgb(155, 81, 224)');

    // LIGHTNING_PUNCH / LIGHTNING_BOLT / POWER_BLAST (Gold)
    renderer.updateGlove(landmarks, 2800, { activePower: { name: 'LIGHTNING_BOLT' } });
    expect(ctx.shadowColors).toContain('rgb(245, 166, 35)');

    // SHIELD / LIGHTNING_SHIELD (Blue)
    renderer.updateGlove(landmarks, 2900, { activePower: { name: 'LIGHTNING_SHIELD' } });
    expect(ctx.shadowColors).toContain('rgb(79, 172, 254)');
  });

  it('should invoke canvas context drawing commands during render', () => {
    const ctx = createMockContext();
    const renderer = new EnergyGloveRenderer(ctx);
    const landmarks = createMockLandmarks();

    renderer.updateGlove(landmarks, 1000, null);
    renderer.updateGlove(landmarks, 2500, null); // Active state

    // Reset mocks to count calls on a specific active render loop frame
    vi.clearAllMocks();
    renderer.updateGlove(landmarks, 2600, null);

    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.moveTo).toHaveBeenCalled();
    expect(ctx.lineTo).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });
});
