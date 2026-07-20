export class TrainingRng {
  state: number;

  constructor(state: number) {
    this.state = state >>> 0 || 0x6D2B79F5;
  }

  next(): number {
    let t = (this.state += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  normal(): number {
    const u = Math.max(Number.EPSILON, this.next());
    const v = Math.max(Number.EPSILON, this.next());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}
