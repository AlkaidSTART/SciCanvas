import { describe, expect, it, vi } from 'vitest'
import type { Scene2DExperimentSpec } from '../ai/schema'
import { compileScene2DExperiment } from './scene2dRenderer'
import type { Scene2DState } from './scene2dRenderer'

function createMockCtx(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    arc: vi.fn(),
    ellipse: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    clip: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 7 })),
    setLineDash: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter',
    lineCap: 'butt',
    globalAlpha: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
  } as unknown as CanvasRenderingContext2D
}

const sampleSpec: Scene2DExperimentSpec = {
  title: '正弦波与包络标点',
  domain: 'Physics / Waves',
  formulaLatex: 'y(x,t) = A e^{-0.1 x} \\sin(k x - t)',
  insight: '拖动振幅 A 观察曲线与关键标点实时同步。',
  renderType: 'scene2d',
  controls: [
    { type: 'slider', key: 'A', label: '振幅', min: 0.5, max: 3, step: 0.1, default: 2 },
    { type: 'slider', key: 'k', label: '波数', min: 0.5, max: 4, step: 0.1, default: 1.5 },
  ],
  legend: [{ label: '波形 y(x)', color: '#4F7292' }],
  scene: {
    coordinate: {
      xDomain: [0, 10],
      yDomain: [-3.5, 3.5],
      xLabel: 'x (m)',
      yLabel: 'y (m)',
    },
    variables: {
      y0: 'A * sin(-t)',
    },
    elements: [
      {
        id: 'wave',
        type: 'curve',
        mode: 'explicit',
        y: 'A * exp(-0.1 * x) * sin(k * x - t)',
        samples: 80,
        stroke: 'blue',
      },
      {
        id: 'origin-pt',
        type: 'point',
        at: [0, 'y0'],
        color: 'peach',
        label: '起点',
        showCoords: true,
      },
      {
        id: 'note',
        type: 'annotation',
        at: [5, 2.8],
        text: '振幅 A = {{A}}',
        badge: true,
      },
    ],
    telemetry: {
      metrics: [{ key: 'y0', label: '起点位移', color: 'peach', expr: 'y0' }],
    },
  },
}

describe('compileScene2DExperiment', () => {
  it('能编译并无异常完成步进、绘制、探针读数与遥测采样', () => {
    const experiment = compileScene2DExperiment(sampleSpec)
    expect(experiment.renderType).toBe('scene2d')
    expect(experiment.probe).toBeDefined()
    expect(experiment.telemetry).toBeDefined()

    const ctx = createMockCtx()
    const params = { A: 2, k: 1.5 }
    const s0 = experiment.model.createState(params)
    const s1 = experiment.model.step(s0, params, 0.5) as Scene2DState
    expect(s1.t).toBeCloseTo(0.5, 6)

    experiment.model.draw(ctx, s1, params, { width: 800, height: 640 })
    expect(ctx.stroke).toHaveBeenCalled()
    expect(ctx.fillText).toHaveBeenCalled()

    const reading = experiment.probe!.read(s1, params, { x: 400, y: 360 }, { width: 800, height: 640 })
    expect(reading).not.toBeNull()
    expect(reading?.label).toBe('曲线函数值 y(x)')

    const sample = experiment.telemetry!.sample(s1, params, s1.t)
    expect(sample.y0).toBeCloseTo(2 * Math.sin(-0.5), 6)
  })
})
