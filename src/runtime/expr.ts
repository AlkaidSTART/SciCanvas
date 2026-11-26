/**
 * 零 eval / 零 new Function 的安全数学表达式引擎。
 * 在校验期完成词法、AST 语法、深度、函数白名单与变量符号静态检查，
 * 运行期直接对 AST 求值，用于驱动 Scene2D 坐标、曲线与标点。
 */

export const MAX_EXPR_LENGTH = 240
export const MAX_EXPR_DEPTH = 16
export const MAX_TEMPLATE_EXPRS = 4

export const BUILTIN_CONSTANTS: Readonly<Record<string, number>> = {
  pi: Math.PI,
  PI: Math.PI,
  e: Math.E,
  E: Math.E,
}

interface FunctionSpec {
  minArgs: number
  maxArgs: number
  fn: (...args: number[]) => number
}

const FUNCTIONS: Readonly<Record<string, FunctionSpec>> = {
  sin: { minArgs: 1, maxArgs: 1, fn: (x) => Math.sin(x) },
  cos: { minArgs: 1, maxArgs: 1, fn: (x) => Math.cos(x) },
  tan: { minArgs: 1, maxArgs: 1, fn: (x) => Math.tan(x) },
  asin: { minArgs: 1, maxArgs: 1, fn: (x) => Math.asin(x) },
  acos: { minArgs: 1, maxArgs: 1, fn: (x) => Math.acos(x) },
  atan: { minArgs: 1, maxArgs: 1, fn: (x) => Math.atan(x) },
  atan2: { minArgs: 2, maxArgs: 2, fn: (y, x) => Math.atan2(y, x) },
  sinh: { minArgs: 1, maxArgs: 1, fn: (x) => Math.sinh(x) },
  cosh: { minArgs: 1, maxArgs: 1, fn: (x) => Math.cosh(x) },
  tanh: { minArgs: 1, maxArgs: 1, fn: (x) => Math.tanh(x) },
  exp: { minArgs: 1, maxArgs: 1, fn: (x) => Math.exp(x) },
  log: { minArgs: 1, maxArgs: 1, fn: (x) => Math.log(x) },
  log10: { minArgs: 1, maxArgs: 1, fn: (x) => Math.log10(x) },
  sqrt: { minArgs: 1, maxArgs: 1, fn: (x) => Math.sqrt(x) },
  pow: { minArgs: 2, maxArgs: 2, fn: (a, b) => Math.pow(a, b) },
  abs: { minArgs: 1, maxArgs: 1, fn: (x) => Math.abs(x) },
  sign: { minArgs: 1, maxArgs: 1, fn: (x) => Math.sign(x) },
  floor: { minArgs: 1, maxArgs: 1, fn: (x) => Math.floor(x) },
  ceil: { minArgs: 1, maxArgs: 1, fn: (x) => Math.ceil(x) },
  round: { minArgs: 1, maxArgs: 1, fn: (x) => Math.round(x) },
  min: { minArgs: 2, maxArgs: 8, fn: (...args) => Math.min(...args) },
  max: { minArgs: 2, maxArgs: 8, fn: (...args) => Math.max(...args) },
  clamp: {
    minArgs: 3,
    maxArgs: 3,
    fn: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  },
  lerp: {
    minArgs: 3,
    maxArgs: 3,
    fn: (a, b, t) => a + (b - a) * t,
  },
  step: {
    minArgs: 2,
    maxArgs: 2,
    fn: (edge, x) => (x < edge ? 0 : 1),
  },
  smoothstep: {
    minArgs: 3,
    maxArgs: 3,
    fn: (e0, e1, x) => {
      if (e1 === e0) return x < e0 ? 0 : 1
      const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
      return t * t * (3 - 2 * t)
    },
  },
  mod: {
    minArgs: 2,
    maxArgs: 2,
    fn: (a, b) => (b === 0 ? Number.NaN : ((a % b) + b) % b),
  },
}

export const ALLOWED_FUNCTION_NAMES = Object.keys(FUNCTIONS)

type TokenType =
  | 'number'
  | 'ident'
  | 'op'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'question'
  | 'colon'
  | 'eof'

interface Token {
  type: TokenType
  value: string
  pos: number
}

export type ExprNode =
  | { kind: 'number'; value: number }
  | { kind: 'ident'; name: string }
  | { kind: 'unary'; op: '+' | '-' | '!'; arg: ExprNode }
  | { kind: 'binary'; op: string; left: ExprNode; right: ExprNode }
  | { kind: 'ternary'; cond: ExprNode; consequent: ExprNode; alternate: ExprNode }
  | { kind: 'call'; name: string; args: ExprNode[] }

export type ExprEvaluator = (scope: Readonly<Record<string, number>>) => number

export type ParseExprResult =
  | { ok: true; ast: ExprNode; identifiers: Set<string>; depth: number }
  | { ok: false; message: string }

export type CompileExprResult =
  | { ok: true; evaluate: ExprEvaluator; identifiers: Set<string> }
  | { ok: false; message: string }

const TWO_CHAR_OPS = new Set(['<=', '>=', '==', '!=', '&&', '||', '**'])
const ONE_CHAR_OPS = new Set(['+', '-', '*', '/', '%', '^', '<', '>', '!'])

function tokenize(source: string): { ok: true; tokens: Token[] } | { ok: false; message: string } {
  const tokens: Token[] = []
  let i = 0
  const len = source.length

  while (i < len) {
    const ch = source[i]
    if (/\s/.test(ch)) {
      i += 1
      continue
    }

    if ((ch >= '0' && ch <= '9') || (ch === '.' && i + 1 < len && source[i + 1] >= '0' && source[i + 1] <= '9')) {
      const start = i
      let hasDot = false
      while (i < len && ((source[i] >= '0' && source[i] <= '9') || source[i] === '.')) {
        if (source[i] === '.') {
          if (hasDot) return { ok: false, message: `位置 ${i} 出现多余小数点` }
          hasDot = true
        }
        i += 1
      }
      if (i < len && (source[i] === 'e' || source[i] === 'E')) {
        i += 1
        if (i < len && (source[i] === '+' || source[i] === '-')) i += 1
        const expStart = i
        while (i < len && source[i] >= '0' && source[i] <= '9') i += 1
        if (i === expStart) return { ok: false, message: `位置 ${start} 的科学计数法缺少指数` }
      }
      tokens.push({ type: 'number', value: source.slice(start, i), pos: start })
      continue
    }

    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
      const start = i
      while (
        i < len &&
        ((source[i] >= 'a' && source[i] <= 'z') ||
          (source[i] >= 'A' && source[i] <= 'Z') ||
          (source[i] >= '0' && source[i] <= '9') ||
          source[i] === '_')
      ) {
        i += 1
      }
      tokens.push({ type: 'ident', value: source.slice(start, i), pos: start })
      continue
    }

    if (ch === '(') {
      tokens.push({ type: 'lparen', value: ch, pos: i })
      i += 1
      continue
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen', value: ch, pos: i })
      i += 1
      continue
    }
    if (ch === ',') {
      tokens.push({ type: 'comma', value: ch, pos: i })
      i += 1
      continue
    }
    if (ch === '?') {
      tokens.push({ type: 'question', value: ch, pos: i })
      i += 1
      continue
    }
    if (ch === ':') {
      tokens.push({ type: 'colon', value: ch, pos: i })
      i += 1
      continue
    }

    const two = source.slice(i, i + 2)
    if (TWO_CHAR_OPS.has(two)) {
      tokens.push({ type: 'op', value: two === '**' ? '^' : two, pos: i })
      i += 2
      continue
    }
    if (ONE_CHAR_OPS.has(ch)) {
      tokens.push({ type: 'op', value: ch, pos: i })
      i += 1
      continue
    }

    return { ok: false, message: `包含不支持的字符 "${ch}"` }
  }

  tokens.push({ type: 'eof', value: '', pos: len })
  return { ok: true, tokens }
}

class ExprParser {
  private index = 0
  private currentDepth = 0
  maxDepth = 0
  readonly identifiers = new Set<string>()
  private readonly tokens: Token[]

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  private peek(): Token {
    return this.tokens[this.index]
  }

  private consume(): Token {
    const token = this.tokens[this.index]
    this.index += 1
    return token
  }

  private enter(): void {
    this.currentDepth += 1
    if (this.currentDepth > this.maxDepth) this.maxDepth = this.currentDepth
    if (this.currentDepth > MAX_EXPR_DEPTH) {
      throw new Error(`表达式嵌套深度超过上限 ${MAX_EXPR_DEPTH}`)
    }
  }

  private leave(): void {
    this.currentDepth -= 1
  }

  parse(): ExprNode {
    const node = this.parseTernary()
    if (this.peek().type !== 'eof') {
      throw new Error(`意外的符号 "${this.peek().value}"`)
    }
    return node
  }

  private parseTernary(): ExprNode {
    const cond = this.parseOr()
    if (this.peek().type === 'question') {
      this.enter()
      this.consume()
      const consequent = this.parseTernary()
      if (this.peek().type !== 'colon') {
        throw new Error('三元表达式缺少 ":"')
      }
      this.consume()
      const alternate = this.parseTernary()
      this.leave()
      return { kind: 'ternary', cond, consequent, alternate }
    }
    return cond
  }

  private parseOr(): ExprNode {
    let left = this.parseAnd()
    while (this.peek().type === 'op' && this.peek().value === '||') {
      this.enter()
      const op = this.consume().value
      const right = this.parseAnd()
      this.leave()
      left = { kind: 'binary', op, left, right }
    }
    return left
  }

  private parseAnd(): ExprNode {
    let left = this.parseEquality()
    while (this.peek().type === 'op' && this.peek().value === '&&') {
      this.enter()
      const op = this.consume().value
      const right = this.parseEquality()
      this.leave()
      left = { kind: 'binary', op, left, right }
    }
    return left
  }

  private parseEquality(): ExprNode {
    let left = this.parseComparison()
    while (this.peek().type === 'op' && (this.peek().value === '==' || this.peek().value === '!=')) {
      this.enter()
      const op = this.consume().value
      const right = this.parseComparison()
      this.leave()
      left = { kind: 'binary', op, left, right }
    }
    return left
  }

  private parseComparison(): ExprNode {
    let left = this.parseAdditive()
    while (
      this.peek().type === 'op' &&
      (this.peek().value === '<' ||
        this.peek().value === '<=' ||
        this.peek().value === '>' ||
        this.peek().value === '>=')
    ) {
      this.enter()
      const op = this.consume().value
      const right = this.parseAdditive()
      this.leave()
      left = { kind: 'binary', op, left, right }
    }
    return left
  }

  private parseAdditive(): ExprNode {
    let left = this.parseMultiplicative()
    while (this.peek().type === 'op' && (this.peek().value === '+' || this.peek().value === '-')) {
      this.enter()
      const op = this.consume().value
      const right = this.parseMultiplicative()
      this.leave()
      left = { kind: 'binary', op, left, right }
    }
    return left
  }

  private parseMultiplicative(): ExprNode {
    let left = this.parseUnary()
    while (
      this.peek().type === 'op' &&
      (this.peek().value === '*' || this.peek().value === '/' || this.peek().value === '%')
    ) {
      this.enter()
      const op = this.consume().value
      const right = this.parseUnary()
      this.leave()
      left = { kind: 'binary', op, left, right }
    }
    return left
  }

  private parseUnary(): ExprNode {
    if (
      this.peek().type === 'op' &&
      (this.peek().value === '+' || this.peek().value === '-' || this.peek().value === '!')
    ) {
      this.enter()
      const op = this.consume().value as '+' | '-' | '!'
      const arg = this.parseUnary()
      this.leave()
      return { kind: 'unary', op, arg }
    }
    return this.parsePower()
  }

  private parsePower(): ExprNode {
    const left = this.parsePrimary()
    if (this.peek().type === 'op' && this.peek().value === '^') {
      this.enter()
      this.consume()
      // 右结合且允许指数位置出现一元负号，例如 x^-2
      const right = this.parseUnary()
      this.leave()
      return { kind: 'binary', op: '^', left, right }
    }
    return left
  }

  private parsePrimary(): ExprNode {
    const token = this.peek()
    if (token.type === 'number') {
      this.consume()
      const value = Number(token.value)
      if (!Number.isFinite(value)) throw new Error(`数字 "${token.value}" 超出范围`)
      return { kind: 'number', value }
    }

    if (token.type === 'ident') {
      this.consume()
      const name = token.value
      if (this.peek().type === 'lparen') {
        const spec = FUNCTIONS[name]
        if (!spec) {
          throw new Error(`不支持的函数 "${name}"`)
        }
        this.enter()
        this.consume()
        const args: ExprNode[] = []
        if (this.peek().type !== 'rparen') {
          args.push(this.parseTernary())
          while (this.peek().type === 'comma') {
            this.consume()
            args.push(this.parseTernary())
          }
        }
        if (this.peek().type !== 'rparen') {
          throw new Error(`函数 "${name}" 缺少右括号 ")"`)
        }
        this.consume()
        this.leave()
        if (args.length < spec.minArgs || args.length > spec.maxArgs) {
          const expected =
            spec.minArgs === spec.maxArgs
              ? `${spec.minArgs}`
              : `${spec.minArgs}–${spec.maxArgs}`
          throw new Error(`函数 "${name}" 需要 ${expected} 个参数，实际收到 ${args.length} 个`)
        }
        return { kind: 'call', name, args }
      }

      if (!(name in BUILTIN_CONSTANTS)) {
        this.identifiers.add(name)
      }
      return { kind: 'ident', name }
    }

    if (token.type === 'lparen') {
      this.enter()
      this.consume()
      const inner = this.parseTernary()
      if (this.peek().type !== 'rparen') {
        throw new Error('缺少右括号 ")"')
      }
      this.consume()
      this.leave()
      return inner
    }

    throw new Error(
      token.type === 'eof' ? '表达式意外结束' : `无法解析符号 "${token.value}"`,
    )
  }
}

export function parseExpression(source: string): ParseExprResult {
  const trimmed = source.trim()
  if (!trimmed) {
    return { ok: false, message: '表达式不能为空' }
  }
  if (trimmed.length > MAX_EXPR_LENGTH) {
    return { ok: false, message: `表达式长度不能超过 ${MAX_EXPR_LENGTH} 个字符` }
  }

  const lexed = tokenize(trimmed)
  if (!lexed.ok) return lexed

  try {
    const parser = new ExprParser(lexed.tokens)
    const ast = parser.parse()
    return {
      ok: true,
      ast,
      identifiers: parser.identifiers,
      depth: parser.maxDepth,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export function evaluateAst(node: ExprNode, scope: Readonly<Record<string, number>>): number {
  switch (node.kind) {
    case 'number':
      return node.value
    case 'ident': {
      if (node.name in BUILTIN_CONSTANTS) return BUILTIN_CONSTANTS[node.name]
      const value = scope[node.name]
      return typeof value === 'number' ? value : Number.NaN
    }
    case 'unary': {
      const value = evaluateAst(node.arg, scope)
      if (node.op === '+') return +value
      if (node.op === '-') return -value
      return value === 0 || Number.isNaN(value) ? 1 : 0
    }
    case 'binary': {
      if (node.op === '&&') {
        const left = evaluateAst(node.left, scope)
        if (!left) return 0
        return evaluateAst(node.right, scope) ? 1 : 0
      }
      if (node.op === '||') {
        const left = evaluateAst(node.left, scope)
        if (left) return 1
        return evaluateAst(node.right, scope) ? 1 : 0
      }
      const left = evaluateAst(node.left, scope)
      const right = evaluateAst(node.right, scope)
      switch (node.op) {
        case '+':
          return left + right
        case '-':
          return left - right
        case '*':
          return left * right
        case '/':
          return right === 0 ? Number.NaN : left / right
        case '%':
          return right === 0 ? Number.NaN : ((left % right) + right) % right
        case '^':
          return Math.pow(left, right)
        case '<':
          return left < right ? 1 : 0
        case '<=':
          return left <= right ? 1 : 0
        case '>':
          return left > right ? 1 : 0
        case '>=':
          return left >= right ? 1 : 0
        case '==':
          return Math.abs(left - right) <= 1e-9 ? 1 : 0
        case '!=':
          return Math.abs(left - right) > 1e-9 ? 1 : 0
        default:
          return Number.NaN
      }
    }
    case 'ternary': {
      const cond = evaluateAst(node.cond, scope)
      return cond !== 0 && !Number.isNaN(cond)
        ? evaluateAst(node.consequent, scope)
        : evaluateAst(node.alternate, scope)
    }
    case 'call': {
      const spec = FUNCTIONS[node.name]
      if (!spec) return Number.NaN
      const evaluated = node.args.map((arg) => evaluateAst(arg, scope))
      return spec.fn(...evaluated)
    }
  }
}

/**
 * 编译静态数字或表达式字符串，校验所有引用变量均在允许集合内。
 */
export function compileExpression(
  input: number | string,
  allowedIdentifiers: ReadonlySet<string>,
): CompileExprResult {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      return { ok: false, message: '数值必须是有限数字' }
    }
    return {
      ok: true,
      evaluate: () => input,
      identifiers: new Set(),
    }
  }

  const parsed = parseExpression(input)
  if (!parsed.ok) return parsed

  for (const name of parsed.identifiers) {
    if (!allowedIdentifiers.has(name)) {
      return { ok: false, message: `引用了未声明的变量 "${name}"` }
    }
  }

  const ast = parsed.ast
  return {
    ok: true,
    evaluate: (scope) => evaluateAst(ast, scope),
    identifiers: parsed.identifiers,
  }
}

export type TemplateSegment =
  | { kind: 'text'; value: string }
  | { kind: 'expr'; source: string; evaluate: ExprEvaluator; identifiers: Set<string> }

export type CompileTemplateResult =
  | { ok: true; segments: TemplateSegment[]; identifiers: Set<string> }
  | { ok: false; message: string }

const TEMPLATE_PATTERN = /\{\{([^}]*)\}\}/g

/**
 * 解析带 `{{expr}}` 动态插值的标注文本，限制插值块数量并复用 AST 白名单校验。
 */
export function compileTemplateText(
  text: string,
  allowedIdentifiers: ReadonlySet<string>,
): CompileTemplateResult {
  const segments: TemplateSegment[] = []
  const identifiers = new Set<string>()
  let lastIndex = 0
  let exprCount = 0

  for (const match of text.matchAll(TEMPLATE_PATTERN)) {
    const start = match.index ?? 0
    if (start > lastIndex) {
      segments.push({ kind: 'text', value: text.slice(lastIndex, start) })
    }
    exprCount += 1
    if (exprCount > MAX_TEMPLATE_EXPRS) {
      return { ok: false, message: `插值表达式数量不能超过 ${MAX_TEMPLATE_EXPRS} 个` }
    }
    const exprSource = match[1].trim()
    const compiled = compileExpression(exprSource, allowedIdentifiers)
    if (!compiled.ok) {
      return { ok: false, message: `模板 "{{${exprSource}}}" 不合法：${compiled.message}` }
    }
    for (const id of compiled.identifiers) identifiers.add(id)
    segments.push({
      kind: 'expr',
      source: exprSource,
      evaluate: compiled.evaluate,
      identifiers: compiled.identifiers,
    })
    lastIndex = start + match[0].length
  }

  if (lastIndex < text.length) {
    segments.push({ kind: 'text', value: text.slice(lastIndex) })
  }
  return { ok: true, segments, identifiers }
}

export function formatDynamicNumber(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) >= 1000 || (Math.abs(value) > 0 && Math.abs(value) < 0.01)) {
    return value.toExponential(2)
  }
  const fixed = value.toFixed(2)
  return fixed.replace(/\.?0+$/, '') || '0'
}

export function renderTemplateText(
  segments: readonly TemplateSegment[],
  scope: Readonly<Record<string, number>>,
): string {
  let out = ''
  for (const segment of segments) {
    if (segment.kind === 'text') {
      out += segment.value
    } else {
      out += formatDynamicNumber(segment.evaluate(scope))
    }
  }
  return out
}
