const display = document.getElementById("game-canvas");
const displayCtx = display.getContext("2d");

const errLog = document.getElementById("game-error");
const instLog = document.getElementById("game-ins");
const ramLog = document.getElementById("game-ram");
const regLog = document.getElementById("game-reg");


let gameCart = null;

// Time it took to do one step
let stepTime = 0;
let fps = 0;
// Keeps count of number of rendered frames in a second
let renderedFPS = 0;
let CPUOps = getCPUOpsTable();

let RAM = new Uint8Array(4096);
let pixels = new Uint8Array(64 * 32);

// Sprites for the hexadecimal numbers are stored in the region 0x000-0x200
let sprites = new Uint8Array([
	// 0
	0xF0, 0x90, 0x90, 0x90, 0xF0,

	// 1
	0x20, 0x60, 0x20, 0x20, 0x70,

	// 2
	0xF0, 0x10, 0xF0, 0x80, 0xF0,

	// 3
	0xF0, 0x10, 0xF0, 0x10, 0xF0,

	// 4
	0x90, 0x90, 0xF0, 0x10, 0x10,

	// 5
	0xF0, 0x80, 0xF0, 0x10, 0xF0,

	// 6
	0xF0, 0x80, 0xF0, 0x90, 0xF0,

	// 7
	0xF0, 0x10, 0x20, 0x40, 0x40,

	// 8
	0xF0, 0x90, 0xF0, 0x90, 0xF0,

	// 9
	0xF0, 0x90, 0xF0, 0x10, 0xF0,

	// A
	0xF0, 0x90, 0xF0, 0x90, 0x90,

	// B
	0xE0, 0x90, 0xE0, 0x90, 0xE0,

	// C
	0xF0, 0x80, 0x80, 0x80, 0xF0,

	// D
	0xE0, 0x90, 0x90, 0x90, 0xE0,

	// E
	0xF0, 0x80, 0xF0, 0x80, 0xF0,

	// F
	0xF0, 0x80, 0xF0, 0x80, 0x80
]);

let CPU = {

	// The program counter
	PC: 0x200,
	
	// Stack counter
	SP: 0xEA0,

	// Pointer Register (Address register)
	I: 0,

	// TIME Register decremented every 1/60th of a second, if value not 0
	TIME: 0,
	// TONE Register decremented every 1/60th of a second, if value not 0... Emu should make a beep until TONE is 0
	TONE: 0,

	// 16 Pseudo-registers corresponding to input keys
	K: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],

	// 16 8-bit data registers (Vf is used as a flag register)
	V: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],

}

function readWordFromRAM(address) {
	return (RAM[address] << 8) + RAM[address + 1];
}

function bit_test(num, bit){
    return ((num>>bit) % 2 != 0)
}

function bit_set(num, bit){
    return num | 1<<bit;
}

function bit_clear(num, bit){
    return num & ~(1<<bit);
}

function bit_toggle(num, bit){
    return bit_test(num, bit) ? bit_clear(num, bit) : bit_set(num, bit);
}

// Returns a random value from 0 to 255
function randomByte() {
  return Math.floor(Math.random() * (255 - 0 + 1));
}

function splitWordToBytes(word) {
	let right = word & 0xFF;
	let left = ( word >> 8 ) & 0xFF
	
	return [left, right];
}

function getLow12FromWord(word) {
	return word & 0x0FFF;
}

// Splits a word to 4 element array with values ranging from 0-15 corresponding to their hex values
function splitWordToHex(word) {
	return [
		(word & 0xF000) >> 12,
		(word & 0x0F00) >> 8,
		(word & 0x00F0) >> 4,
		(word & 0x000F)
	];
}

// Splits a byte into a 8 element array with values 0 or 1
function splitByteToBits(byte) {
	return [
		(byte & 128) ? 1 : 0,
		(byte & 64) ? 1 : 0,
		(byte & 32) ? 1 : 0,
		(byte & 16) ? 1 : 0,
		(byte & 8) ? 1 : 0,
		(byte & 4) ? 1 : 0,
		(byte & 2) ? 1 : 0,
		(byte & 1) ? 1 : 0,
	];
}

function pushWordToStack(word) {
	const [left, right] = splitWordToBytes(word);

	// Stack memory is from 0xEA0-0xEFF
	RAM[CPU.SP] = left;
	RAM[CPU.SP + 1] = right;
	CPU.SP += 2;
}

function popWordFromStack() {
	const res = readWordFromRAM(CPU.SP - 2);
	CPU.SP -= 2;
	return res;
}

function getCPUOpsTable() {
	let res = [];
	
	// CPU OPs
	// Sets I to the address NNN.
	const ld_i_addr = (inst) => () => {
		const addr = getLow12FromWord(inst);

		logInst(`LD I 0x${addr.toString(16)}`);
		CPU.I = addr;
		
		CPU.PC += 2;
	}

	// Jumps to the address NNN plus V0. 
	const jp_v0_nnn = (inst) => () => {
		const nnn = getLow12FromWord(inst);

		logInst(`JP V0, 0x${nnn.toString(16)}`);
		CPU.PC = CPU.V0 + nnn;
	}
	
	// Calls a subroutine
	const call_addr = (inst) => () => {
		const addr = getLow12FromWord(inst);
		
		pushWordToStack(CPU.PC + 2);
		CPU.PC = addr;

		logInst(`CALL 0x${addr.toString(16)}`);
	}
	
	// Loads an immediate 8bit value to VX (X=0,1,2,3,4,5,6,7,8,9,A,B,C,D,E,F)
	const ld_vx_nn = (inst) => () => {
		const [_, nn] = splitWordToBytes(inst);
		const [_a, vx, _b, _c] = splitWordToHex(inst);

		CPU.V[vx] = nn;
		CPU.PC += 2;

		logInst(`LD V${vx.toString(16)} 0x${nn.toString(16)}`);
	}
	
	// Returns from a subroutine
	const ret = () => {
		CPU.PC = popWordFromStack();
		
		logInst(`RET`);
	}

	const add_vx_nn = (inst) => () => {
		const [_, nn] = splitWordToBytes(inst);
		const [_a, vx, _b, _c] = splitWordToHex(inst);

		CPU.V[vx] += nn;
		CPU.V[vx] &= 255;

		CPU.PC += 2;
		logInst(`ADD V${vx.toString(16)} 0x${nn.toString(16)}`);
	}

	const jp_nnn = (inst) => () => {
		const nnn = getLow12FromWord(inst);

		CPU.PC = nnn;
		logInst(`JP 0x${nnn.toString(16)}`);
	}
	
	// Draws a sprite (Vx, Vy) of width 8px and height N, sets flag if a set pixel is toggled, bitmap data is read from location I
	const drw_vx_vy_n = (inst) => () => {
		const [_, vx, vy, n] = splitWordToHex(inst);
		
		let flippedSetPixel = false;
		
		const x = CPU.V[vx];
		const y = CPU.V[vy];
		
		let i = CPU.I;
		for (let h = 0; h < n; h++) {
			let bmpRow = splitByteToBits(RAM[i]);

			for (let r = 0; r < 8; r++) {
				let pxPos = ((y + h) * 64) + x + r;
				
				if (pixels[pxPos] && bmpRow[r] ^ pixels[pxPos] == 0) {
					flippedSetPixel = true;
				}

				pixels[pxPos] = bmpRow[r] ^ pixels[pxPos];
			}

			i++;
		}

		CPU.V[0xF] = flippedSetPixel ? 1 : 0;
		CPU.PC += 2;
		logInst(`DRW V${vx.toString(16)} V${vy.toString(16)} ${n}`);
	}
	
	// Skips the next instruction if the value in register Vx is equal to the intermediate byte
	const se_vx_nn = (inst) => () => {
		let [_, nn] = splitWordToBytes(inst);

		let [_a, vx, _b, _c] = splitWordToHex(inst);
		
		if (CPU.V[vx] == nn) {
			CPU.PC += 2;
		}

		CPU.PC += 2;
		logInst(`SE V${vx.toString(16)} 0x${nn.toString(16)}`);
	}
	
	// Clears the screen
	const cls = () => {
		pixels.fill(0);

		CPU.PC += 2;
		logInst(`CLS`);
	}
	
	// Skips the next instruction if Vx = Vy
	const se_vx_vy = (inst) => () => {
		const [_, x, y, _a] = splitWordToHex(inst);
		
		if (CPU.V[x] === CPU.V[y]) {
			CPU.PC += 2;
		}

		CPU.PC += 2;
		logInst(`SE V${x.toString(16)} V${y.toString(16)}`);
	}
	
	// Skips the next instruction if Vx not equal to the intermediate byte
	const sne_vx_nn = (inst) => () => {
		const [_, nn] = splitWordToBytes(inst);
		const [_a, x, _b, _c] = splitWordToHex(inst);

		if (CPU.V[x] !== nn) {
			CPU.PC += 2;
		}

		CPU.PC += 2;
		logInst(`SNE V${x.toString(16)} 0x${nn.toString(16)}`);
	}
	
	// Combination of all the 8XXX series arithmetic ops
	const mth = (inst) => () => {
		const [_, vx, vy, op] = splitWordToHex(inst);

		switch (op) {
			case 0: // Assign Vy to Vx
				CPU.V[vx] = CPU.V[vy];
				logInst(`LD V${vx.toString(16)} V${vy.toString(16)}`);
				break;
			case 1: // Vx = Vx | Vy
				CPU.V[vx] |= CPU.V[vy];
				logInst(`OR V${vx.toString(16)} V${vy.toString(16)}`);
				break;
			case 2: // Vx = Vx & Vy
				CPU.V[vx] &= CPU.V[vy];
				logInst(`AND V${vx.toString(16)} V${vy.toString(16)}`);
				break;
			case 3: // Vx = Vx ^ Vy
				CPU.V[vx] ^= CPU.V[vy];
				logInst(`XOR V${vx.toString(16)} V${vy.toString(16)}`);
				break;
			case 4: // Vx = Vx + Vy
				CPU.V[vx] += CPU.V[vy];
				
				if (CPU.V[vx] > 255) { // There is carry
					CPU.V[vx] &= 255;
					CPU.V[0xF] = 1;
				} else CPU.V[0xF] = 0;

				logInst(`ADD V${vx.toString(16)} V${vy.toString(16)}`);
				break;
			case 5: // Vx = Vx - Vy
				
				CPU.V[0xF] = (CPU.V[vx] > CPU.V[vy]) ? 1 : 0;

				CPU.V[vx] -= CPU.V[vy];
				CPU.V[vx] &= 255;
				logInst(`SUB V${vx.toString(16)} V${vy.toString(16)}`);
				break;
			case 6: // Stores the least significant bit of VX in Vf and then shifts VX to the right by 1.
				CPU.V[0xF] = CPU.V[vx] & 0x1;
				CPU.V[vx] = (CPU.V[vx] >> 1);
				logInst(`SHR V${vx.toString(16)}`);
				break;
			case 7: // Vx = Vy - Vx, If Vy > Vx, then Vf = 1 else 0

				CPU.V[0xF] = (CPU.V[vy] > CPU.V[vx]) ? 1 : 0;
				
				CPU.V[vx] = CPU.V[vy] - CPU.V[vx];
				logInst(`SUBN V${vx.toString(16)} V${vy.toString(16)}`);
				break;
			case 14: // Stores the most significant bit of VX in Vf and then shifts VX to the left by 1.
 					CPU.V[0xF] = (CPU.V[vx] >> 7) & 0x1;
                    CPU.V[vx] = (CPU.V[vx] << 1);
				logInst(`SHL V${vx.toString(16)} V${vy.toString(16)}`);
				break;

			default:
				error(`Illegal Math OP, Vx: ${vx.toString(16)}, Vy: ${vy.toString(16)}, N: ${op}`);
				return;
		}

		CPU.PC += 2;
	}

	// Generates a random number from 0-255 and then does and with NN and the resulting value is stored in Vx
	const rnd_vx_nn = (inst) => () => {
		const [_, nn] = splitWordToBytes(inst);
		const [_a, vx, _b, _c] = splitWordToHex(inst);

		CPU.V[vx] = randomByte() & nn;

		CPU.PC += 2;

		logInst(`RND V${vx.toString(16)} 0x${nn.toString(16)}`);
	}

	// A grouped op function for all EXXX series CPU Opcodes
	const e = (inst) => () => {
		const [_, vx, a, b] = splitWordToHex(inst);
		
		let key;
		switch (b) {
			case 1: // Skips the next instruction if the key stored in Vx is pressed.
				key = CPU.V[vx];
				if (!CPU.K[key]) CPU.PC += 2;
				break;
			case 14: // Skips the next instruction if the key stored in Vx is pressed. 
				key = CPU.V[vx];
				if (CPU.K[key]) CPU.PC += 2;
				break;
			default:
				error(`Illegal E series instruction. OP : 0x${inst.toString(16)}`);
				return;
		}

		CPU.PC += 2;
	}

	// A grouped op function for all the FXXX series CPU Opcodes
	const f = (inst) => () => {
		const [_, vx, a, b] = splitWordToHex(inst);

		switch (b) {
			
			case 3: // Stores the BCD represented data in Vx to address I
				const value = CPU.V[vx];
				RAM[CPU.I] = (value % 1000) / 100;
				RAM[CPU.I + 1] = (value % 100) / 10;
				RAM[CPU.I + 2] = value % 10;
				break;

			case 5:	
				
				if (a == 1) {
					// Sets the TIME timer to Vx
					CPU.TIME = CPU.V[vx];
					
					logInst(`LD TIME V${vx.toString(16)}`);
				} else if (a == 6) { // Fills the registers V0-Vx (inclusive) with contents from address I (progressively)
					for (let x = 0; x <= vx; x++) {
						CPU.V[x] = RAM[CPU.I + x];
					}

					logInst(`LD V${vx.toString(16)} [I]`);
				} else if (a == 5) { // Fills the content of I and the subsequent address with the contents registers V0-Vx (inclusive)
					for (let x = 0; x <= vx; x++) {
						RAM[CPU.I + x] = CPU.V[x];
					}
					logInst(`LD [I] V${vx.toString(16)}`);
				} else {
					error(`unimplemented fxx5 series OP: 0x${inst.toString(16)}`);
					return;
				}
				break;

			case 7: // Sets Vx to TIME timer
				CPU.V[vx] = CPU.TIME;
				break;
			
			case 9: // Sets I to the given hex characters sprite area
				CPU.I = 5 * CPU.V[vx];
				break;

			case 10: // Halts the CPU until a key is pressed, the pressed key is then stored in Vx
				for (let i = 0; i < 16; i++) {
					if (CPU.K[i]) {
						CPU.V[vx] = i;
						CPU.PC += 2;
						return;
					}
				} // No keys found so return the function thereby not incrementing PC
				return;

			case 14: // Adds VX to I
				CPU.I += CPU.V[vx];
				if (CPU.I > 4096) { // Carry
					CPU.I &= 4096;
					CPU.V[0xf] = 1;
				} else CPU.V[0xf] = 0;
				break;
			default:
				error(`Illegal F series op: 0x${inst.toString(16)}`)
				return;
		}

		CPU.PC += 2;
	}

	// Skips next instruction if Vx != Vy
	const sne_vx_vy = (inst) => () => {
		const [_, vx, vy, _a] = splitWordToHex(inst);
		
		if (CPU.V[vx] !== CPU.V[vy]) {
			CPU.PC += 2;
		}

		CPU.PC += 2;
	}

	res[0x00E0] = cls;
	res[0x00EE] = ret;
	
	let i;

	for (i = 0x1000; i <= 0x1FFF; i++) res[i] = jp_nnn(i);
	for (i = 0x2000; i <= 0x2FFF; i++) res[i] = call_addr(i);
	for (i = 0x3000; i <= 0x3FFF; i++) res[i] = se_vx_nn(i);
	for (i = 0x4000; i <= 0x4FFF; i++) res[i] = sne_vx_nn(i);
	for (i = 0x5000; i <= 0x5FFF; i++) res[i] = se_vx_vy(i);
	for (i = 0x6000; i <= 0x6FFF; i++) res[i] = ld_vx_nn(i);
	for (i = 0x7000; i <= 0x7FFF; i++) res[i] = add_vx_nn(i);
	for (i = 0x8000; i <= 0x8FFF; i++) res[i] = mth(i);
	for (i = 0x9000; i <= 0x9FFF; i++) res[i] = sne_vx_vy(i);
	for (i = 0xA000; i <= 0xAFFF; i++) res[i] = ld_i_addr(i);
	for (i = 0xB000; i <= 0xBFFF; i++) res[i] = jp_v0_nnn(i);
	for (i = 0xC000; i <= 0xCFFF; i++) res[i] = rnd_vx_nn(i);
	for (i = 0xD000; i <= 0xDFFF; i++) res[i] = drw_vx_vy_n(i);
	for (i = 0xE000; i <= 0xEFFF; i++) res[i] = e(i);
	for (i = 0xF000; i <= 0xFFFF; i++) res[i] = f(i);

	return res;
}

async function setup() {
	
	gameCart = new Uint8Array(await (await fetch("tetris.ch8")).arrayBuffer());
	
	// Loads the hex sprites into RAM
	RAM.set(sprites, 0x000);

	// Loads the cart into RAM
	RAM.set(gameCart, 0x200);
	
	// Fill screen with black
	pixels.fill(0);

	// Add keyboard event listeners
	let keys = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E'].map((key) => key.charCodeAt(0));

	document.addEventListener('keydown', (ev) => {
		if (keys.includes(ev.keyCode)) CPU.K[keys.indexOf(ev.keyCode)] = 1
	});
	document.addEventListener('keyup', (ev) => {
		if (keys.includes(ev.keyCode)) CPU.K[keys.indexOf(ev.keyCode)] = 0;
	});

	drawDisplay();
	displayDebugData();
}

function drawDisplay() {
	for (let i = 0; i < pixels.length; i++) {
		displayCtx.fillStyle = pixels[i] ? 'white' : 'black';
		displayCtx.fillRect((i % 64) * 8, Math.floor(i / 64) * 8, 8, 8);
	}
}

function step() {
	const stepStart = Date.now();

	if (CPUOps[readWordFromRAM(CPU.PC)]) {
		CPUOps[readWordFromRAM(CPU.PC)]();

		drawDisplay();
		displayDebugData();
	} else {
		error(`Unknown Instruction called : 0x${readWordFromRAM(CPU.PC).toString(16)}`);
		
		clearInterval(runLoop);
		clearInterval(timerLoop);
	}

	stepTime = Date.now() - stepStart;
	renderedFPS++;
}

function updateTimers() {
	if (CPU.TIME != 0) CPU.TIME--;
	if (CPU.TONE != 0) CPU.TONE--;
}

function setFPS() {
	fps = renderedFPS;
	renderedFPS = 0;
}

function run() {
	runLoop = setInterval(step, Math.floor(1000 / 500)); // Run at 500Hz
	timerLoop = setInterval(updateTimers, Math.floor(1000 / 60)); // Both of the timers decrement at a 60Hz rate
	fpsLoop = setInterval(setFPS, 1000);
}

function stop() {
	if (runLoop) clearInterval(runLoop);
	if (timerLoop) clearInterval(timerLoop);
	if (fpsLoop) clearInterval(fpsLoop);
}

function logInst(inst) {
	instLog.innerHTML = `${inst}<br>${instLog.innerHTML}`;
}

function displayDebugData() {
	let regStr = `
		Frame Time: ${stepTime}ms<br>
		FPS: ${fps}<br>
		<br>
		PC: 0x${CPU.PC.toString(16)} SP: 0x${CPU.SP.toString(16)} I: 0x${CPU.I.toString(16)}<br>
		TIME: ${CPU.TIME} TONE: ${CPU.TONE}<br>
		K0: ${CPU.K[0x0]} K1: ${CPU.K[0x1]} K2: ${CPU.K[0x2]} K3: ${CPU.K[0x3]} K4: ${CPU.K[0x4]} K5: ${CPU.K[0x5]}
		K6: ${CPU.K[0x6]} K7: ${CPU.K[0x7]} K8: ${CPU.K[0x8]} K9: ${CPU.K[0x9]} KA: ${CPU.K[0xa]} KB: ${CPU.K[0xb]}
		KC: ${CPU.K[0xc]} KD: ${CPU.K[0xd]} KE: ${CPU.K[0xe]} KF: ${CPU.K[0xf]}<br>

		V0: ${CPU.V[0x0]} V1: ${CPU.V[0x1]} V2: ${CPU.V[0x2]} V3: ${CPU.V[0x3]} V4: ${CPU.V[0x4]} V5: ${CPU.V[0x5]}
		V6: ${CPU.V[0x6]} V7: ${CPU.V[0x7]} V8: ${CPU.V[0x8]} V9: ${CPU.V[0x9]} VA: ${CPU.V[0xa]} VB: ${CPU.V[0xb]}
		VC: ${CPU.V[0xc]} VD: ${CPU.V[0xd]} VE: ${CPU.V[0xe]} VF: ${CPU.V[0xf]}<br>
	`;

	regLog.innerHTML = regStr;
	
	let ramStr = "";
	for (let i = 0; i < RAM.length; i++) {
		if (i == CPU.PC || i == CPU.PC + 1) {
			ramStr += `<span class='ram-pc'>${RAM[i].toString(16)}</span>  `;
		} else if (i == CPU.I) {
			ramStr += `<span class='ram-i'>${RAM[i].toString(16)}</span>  `
		} else if (i == CPU.SP) {
			ramStr += `<span class='ram-sp'>${RAM[i].toString(16)}</span>  `
		} else ramStr += RAM[i].toString(16) + "  ";
	}

	ramLog.innerHTML = ramStr;
}

function error(errorMsg) {
	errLog.innerHTML = errorMsg;
}

setup();
