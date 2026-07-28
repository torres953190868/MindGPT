import CSSMatrix from "dommatrix";

type DOMMatrixInit =
  | number[]
  | Float32Array
  | Float64Array
  | string
  | DOMMatrix
  | CSSMatrix
  | PolyfilledDOMMatrix;

class PolyfilledDOMMatrix {
  static fromArray(array: number[] | Float32Array | Float64Array): PolyfilledDOMMatrix {
    return new PolyfilledDOMMatrix(CSSMatrix.fromArray(Array.from(array)));
  }

  static fromString(matrixString: string): PolyfilledDOMMatrix {
    return new PolyfilledDOMMatrix(matrixString);
  }

  static fromMatrix(matrix: DOMMatrixInit): PolyfilledDOMMatrix {
    return new PolyfilledDOMMatrix(matrix);
  }

  private matrix: CSSMatrix;

  constructor(init?: DOMMatrixInit) {
    if (init instanceof PolyfilledDOMMatrix) {
      this.matrix = new CSSMatrix(init.matrix.toString());
    } else if (init instanceof CSSMatrix) {
      this.matrix = new CSSMatrix(init.toString());
    } else if (typeof init === "string") {
      this.matrix = new CSSMatrix(init);
    } else if (Array.isArray(init) || init instanceof Float32Array || init instanceof Float64Array) {
      this.matrix = CSSMatrix.fromArray(Array.from(init));
    } else {
      this.matrix = new CSSMatrix();
    }
  }

  get a(): number {
    return this.matrix.a;
  }

  get b(): number {
    return this.matrix.b;
  }

  get c(): number {
    return this.matrix.c;
  }

  get d(): number {
    return this.matrix.d;
  }

  get e(): number {
    return this.matrix.e;
  }

  get f(): number {
    return this.matrix.f;
  }

  get m11(): number {
    return this.matrix.a;
  }

  get m12(): number {
    return this.matrix.b;
  }

  get m21(): number {
    return this.matrix.c;
  }

  get m22(): number {
    return this.matrix.d;
  }

  get m41(): number {
    return this.matrix.e;
  }

  get m42(): number {
    return this.matrix.f;
  }

  multiplySelf(other: DOMMatrixInit): this {
    this.matrix = this.matrix.multiply(new CSSMatrix(this.serialize(other)));
    return this;
  }

  preMultiplySelf(other: DOMMatrixInit): this {
    this.matrix = new CSSMatrix(this.serialize(other)).multiply(this.matrix);
    return this;
  }

  translateSelf(x = 0, y = 0): this {
    this.matrix = this.matrix.translate(x, y);
    return this;
  }

  scaleSelf(scaleX = 1, scaleY = scaleX): this {
    this.matrix = this.matrix.scale(scaleX, scaleY);
    return this;
  }

  rotateSelf(angle = 0): this {
    this.matrix = this.matrix.rotate(angle);
    return this;
  }

  invertSelf(): this {
    const determinant =
      this.matrix.a * this.matrix.d - this.matrix.b * this.matrix.c;
    if (determinant === 0) {
      // Fallback: non-invertible matrices should still produce a valid object
      // to avoid throwing in pdf.js path handling.
      this.matrix = new CSSMatrix();
      return this;
    }
    const invDet = 1 / determinant;
    const a = this.matrix.d * invDet;
    const b = -this.matrix.b * invDet;
    const c = -this.matrix.c * invDet;
    const d = this.matrix.a * invDet;
    const e = (this.matrix.c * this.matrix.f - this.matrix.d * this.matrix.e) * invDet;
    const f = (this.matrix.b * this.matrix.e - this.matrix.a * this.matrix.f) * invDet;
    this.matrix = CSSMatrix.fromArray([a, b, c, d, e, f]);
    return this;
  }

  toString(): string {
    return this.matrix.toString();
  }

  private serialize(init: DOMMatrixInit): string {
    if (init instanceof PolyfilledDOMMatrix) {
      return init.toString();
    }
    if (init instanceof CSSMatrix) {
      return init.toString();
    }
    if (typeof init === "string") {
      return init;
    }
    if (Array.isArray(init) || init instanceof Float32Array || init instanceof Float64Array) {
      return CSSMatrix.fromArray(Array.from(init)).toString();
    }
    return new CSSMatrix().toString();
  }
}

if (typeof globalThis.DOMMatrix === "undefined") {
  // @ts-expect-error polyfill for Node.js serverless runtimes (e.g. Vercel)
  globalThis.DOMMatrix = PolyfilledDOMMatrix;
}
