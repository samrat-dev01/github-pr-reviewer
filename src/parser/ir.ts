import ts from "typescript";

export interface IRSymbol {
  type: "function" | "method" | "class";
  name: string; line: number; endLine: number; params: number; complexity: number;
}
export interface IRImport { module: string; line: number; typeOnly: boolean }
export interface IRCall { target: string; line: number }
export interface FileIR {
  language: "javascript" | "typescript";
  file: string; loc: number;
  symbols: IRSymbol[]; imports: IRImport[]; calls: IRCall[];
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

const isFn = (n: ts.Node): n is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) ||
  ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n);

function fnName(n: ts.FunctionLikeDeclaration): string {
  if (ts.isConstructorDeclaration(n)) return "constructor";
  const nm = (n as { name?: ts.Node }).name;
  if (nm && (ts.isIdentifier(nm) || ts.isStringLiteral(nm))) return nm.text;
  const p = n.parent;
  if ((ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) && ts.isIdentifier(p.name)) {
    return p.name.text;
  }
  return "<anonymous>";
}

/** Cyclomatic complexity, not descending into nested functions. */
function complexity(fn: ts.Node): number {
  let c = 1;
  const walk = (n: ts.Node) => {
    if (n !== fn && isFn(n)) return;
    switch (n.kind) {
      case ts.SyntaxKind.IfStatement:
      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.ForOfStatement:
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement:
      case ts.SyntaxKind.CaseClause:
      case ts.SyntaxKind.CatchClause:
      case ts.SyntaxKind.ConditionalExpression:
        c++;
        break;
      case ts.SyntaxKind.BinaryExpression: {
        const k = (n as ts.BinaryExpression).operatorToken.kind;
        if (k === ts.SyntaxKind.AmpersandAmpersandToken || k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.QuestionQuestionToken) c++;
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(fn);
  return c;
}

export function parseFileIR(file: string, text: string): FileIR {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const symbols: IRSymbol[] = [];
  const imports: IRImport[] = [];
  const calls: IRCall[] = [];
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;

  const visit = (n: ts.Node) => {
    const line = lineOf(n.getStart(sf));
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      imports.push({ module: n.moduleSpecifier.text, line, typeOnly: !!n.importClause?.isTypeOnly });
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      imports.push({ module: n.moduleSpecifier.text, line, typeOnly: n.isTypeOnly });
    } else if (ts.isCallExpression(n)) {
      const a0 = n.arguments[0];
      const literal = a0 && ts.isStringLiteralLike(a0) ? a0.text : undefined;
      if (literal && ts.isIdentifier(n.expression) && n.expression.text === "require") {
        imports.push({ module: literal, line, typeOnly: false });
      } else if (literal && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
        imports.push({ module: literal, line, typeOnly: false });
      } else {
        calls.push({ target: n.expression.getText(sf).slice(0, 80), line });
      }
    }

    if (isFn(n)) {
      const isMethod = ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n);
      symbols.push({
        type: isMethod ? "method" : "function", name: fnName(n), line,
        endLine: lineOf(n.getEnd()), params: n.parameters.length, complexity: complexity(n),
      });
    } else if (ts.isClassDeclaration(n) && n.name) {
      symbols.push({ type: "class", name: n.name.text, line, endLine: lineOf(n.getEnd()), params: 0, complexity: 0 });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);

  return {
    language: /\.[cm]?tsx?$/.test(file) ? "typescript" : "javascript",
    file, loc: text.split("\n").length, symbols, imports, calls,
  };
}