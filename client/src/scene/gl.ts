/** A full-screen fragment shader and the least WebGL needed to run it. */
export class ShaderPass {
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly locations = new Map<string, WebGLUniformLocation | null>();

  private constructor(gl: WebGLRenderingContext, program: WebGLProgram) {
    this.gl = gl;
    this.program = program;
  }

  /** Null when WebGL isn't available or the shader won't compile; the caller falls back. */
  static create(canvas: HTMLCanvasElement, vertex: string, fragment: string): ShaderPass | null {
    const options: WebGLContextAttributes = { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'default' };
    const gl = (canvas.getContext('webgl2', options) ?? canvas.getContext('webgl', options)) as WebGLRenderingContext | null;
    if (!gl) return null;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Scene shader failed to compile:', gl.getShaderInfoLog(shader));
        return null;
      }
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, vertex);
    const fs = compile(gl.FRAGMENT_SHADER, fragment);
    const program = gl.createProgram();
    if (!vs || !fs || !program) return null;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, 'aPos');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Scene shader failed to link:', gl.getProgramInfoLog(program));
      return null;
    }
    gl.useProgram(program);
    // One triangle that covers the screen.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    return new ShaderPass(gl, program);
  }

  get lost(): boolean {
    return this.gl.isContextLost();
  }

  private loc(name: string): WebGLUniformLocation | null {
    let location = this.locations.get(name);
    if (location === undefined) {
      location = this.gl.getUniformLocation(this.program, name);
      this.locations.set(name, location);
    }
    return location;
  }

  set1(name: string, x: number): void {
    this.gl.uniform1f(this.loc(name), x);
  }

  set2(name: string, x: number, y: number): void {
    this.gl.uniform2f(this.loc(name), x, y);
  }

  set3(name: string, v: readonly [number, number, number] | readonly number[]): void {
    this.gl.uniform3f(this.loc(name), v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
  }

  set4(name: string, x: number, y: number, z: number, w: number): void {
    this.gl.uniform4f(this.loc(name), x, y, z, w);
  }

  set4v(name: string, values: Float32Array): void {
    this.gl.uniform4fv(this.loc(name), values);
  }

  draw(width: number, height: number): void {
    const { gl } = this;
    gl.viewport(0, 0, width, height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
