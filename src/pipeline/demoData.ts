import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { DocumentMap, IPSpec } from '../schema/index.ts';

export type DemoPresetId = 'uart_16550' | 'apb_timer_pwm' | 'qspi_xip';

export interface DemoSpecPreset {
  id: DemoPresetId;
  label: string;
  shortLabel: string;
  fileName: string;
  pagesText: string[];
  docMap: DocumentMap;
  spec: IPSpec;
  specV2: IPSpec;
  rtlCode: string;
  cHeaderCode: string;
}

export const DEMO_SPEC_PAGES_TEXT: string[] = [
  // Page 1: Overview & Architecture
  `AXI_UART_16550 — High-Speed Universal Asynchronous Receiver/Transmitter IP
Document Revision: v1.4 | Bus Interface: 32-bit AMBA APB4 / AXI4-Lite | Base Address: 0x4000_1000

1. Architectural Overview
The AXI_UART_16550 IP core provides full-duplex serial communication with 64-byte TX/RX FIFOs,
programmable fractional baud rate generation, hardware flow control (RTS/CTS), and maskable interrupts.
All registers are 32 bits wide and aligned on 4-byte address boundaries.

Normative Architecture Requirements:
[REQ-UART-001] (Section 1.2) The AXI_UART_16550 slave interface shall respond to unmapped register offsets within the 4 KB aperture with zero read data and PSLVERR asserted.
[REQ-UART-002] (Section 1.3) All control and status registers shall support 32-bit aligned word accesses aligned to a 4-byte boundary.`,

  // Page 2: Register Map Summary & CTRL Register (0x00)
  `2. Register Map & Bitfield Descriptions
Address Base: 0x4000_1000 | Register Width: 32 bits

2.1 CTRL — UART Master Control Register
Address Offset: 0x00 | Width: 32 bits | Reset Value: 0x00000001
Description: Configures transmitter/receiver enable states, parity mode, loopback, and oversampling ratio.

Bitfields for CTRL (Offset 0x00, Reset 0x00000001):
- Bits [31:8] RESERVED (Access: RESERVED, Reset: 0x0): Reserved bits, read as 0, write 0.
- Bits [7:6]  PARITY_MODE (Access: RW, Reset: 0x0): Selects serial parity generation and checking mode.
              Enum Values: NONE=0x0, ODD=0x1, EVEN=0x2, FORCE_0=0x3.
- Bits [5:4]  OVERSAMPLE (Access: RW, Reset: 0x0): Receiver oversampling clock ratio (0x0=16x, 0x1=8x, 0x2=4x).
- Bit  [3]    LOOPBACK_EN (Access: RW, Reset: 0x0): Internal diagnostic TX-to-RX loopback enable.
- Bit  [2]    FLOW_CTRL_EN (Access: RW, Reset: 0x0): Hardware RTS/CTS automatic flow control enable.
- Bit  [1]    RX_EN (Access: RW, Reset: 0x0): Receiver state machine enable.
- Bit  [0]    TX_EN (Access: RW, Reset: 0x1): Transmitter state machine enable (enabled by default at reset).`,

  // Page 3: STATUS Register (0x04) & BAUD_DIV Register (0x08)
  `2.2 STATUS — Line & FIFO Status Register
Address Offset: 0x04 | Width: 32 bits | Reset Value: 0x00000003
Description: Real-time transmitter/receiver readiness and sticky framing/overrun error indicators.

Bitfields for STATUS (Offset 0x04, Reset 0x00000003):
- Bits [31:6] RESERVED (Access: RESERVED, Reset: 0x0): Reserved bits.
- Bit  [5]    FRAMING_ERR (Access: W1C, Reset: 0x0): Sticky stop-bit framing error flag. Write 1 to clear.
- Bit  [4]    PARITY_ERR (Access: W1C, Reset: 0x0): Sticky parity mismatch flag. Write 1 to clear.
- Bit  [3]    OVERRUN_ERR (Access: W1C, Reset: 0x0): RX FIFO overrun error flag. Write 1 to clear.
- Bit  [2]    RX_FULL (Access: RO, Reset: 0x0): Asserted when RX FIFO contains 64 entries.
- Bit  [1]    TX_EMPTY (Access: RO, Reset: 0x1): Asserted when TX FIFO is completely empty after reset.
- Bit  [0]    READY (Access: RO, Reset: 0x1): Transceiver clock domain ready status (resets to 0x1).

2.3 BAUD_DIV — Fractional Baud Rate Divisor Register
Address Offset: 0x08 | Width: 32 bits | Reset Value: 0x00000068
Description: Configures 16-bit integer and 6-bit fractional baud clock divider.

Bitfields for BAUD_DIV (Offset 0x08, Reset 0x00000068):
- Bits [31:22] RESERVED (Access: RESERVED, Reset: 0x0): Reserved bits.
- Bits [21:16] FRAC_DIV (Access: RW, Reset: 0x0): 6-bit fractional baud rate divisor (N/64).
- Bits [15:0]  INT_DIV (Access: RW, Reset: 0x0068): 16-bit integer baud rate divisor (defaults to 0x0068 for 115200 baud @ 100MHz).`,

  // Page 4: FIFO_CTRL (0x0C) & INT_ENABLE (0x10)
  `2.4 FIFO_CTRL — TX/RX FIFO Threshold & Flush Control Register
Address Offset: 0x0C | Width: 32 bits | Reset Value: 0x00000200
Description: Controls TX/RX FIFO watermark trigger levels and one-shot FIFO clear strobes.

Bitfields for FIFO_CTRL (Offset 0x0C, Reset 0x00000200):
- Bits [11:8] RX_TRIG_LVL (Access: RW, Reset: 0x2): RX FIFO interrupt watermark level (0x0=1B, 0x1=16B, 0x2=32B, 0x3=56B).
- Bits [7:4]  TX_TRIG_LVL (Access: RW, Reset: 0x0): TX FIFO empty watermark level.
- Bit  [1]    RX_FIFO_CLR (Access: W1S, Reset: 0x0): Self-clearing RX FIFO flush strobe.
- Bit  [0]    TX_FIFO_CLR (Access: W1S, Reset: 0x0): Self-clearing TX FIFO flush strobe.
(Note: Bits [31:12] and [3:2] are unallocated in the table.)

2.5 INT_EN — Interrupt Mask & Enable Register
Address Offset: 0x10 | Width: 32 bits | Reset Value: 0x00000000
Description: Enables individual interrupt sources to drive the system IRQ line.

Bitfields for INT_EN (Offset 0x10, Reset 0x00000000):
- Bits [31:4] RESERVED (Access: RESERVED, Reset: 0x0): Reserved bits.
- Bit  [3]    ERR_INT_EN (Access: RW, Reset: 0x0): Enable framing/parity/overrun error interrupt.
- Bit  [2]    TIMEOUT_INT_EN (Access: RW, Reset: 0x0): Enable RX character timeout interrupt.
- Bit  [1]    RX_WM_INT_EN (Access: RW, Reset: 0x0): Enable RX FIFO watermark reached interrupt.
- Bit  [0]    TX_WM_INT_EN (Access: RW, Reset: 0x0): Enable TX FIFO watermark reached interrupt.`,

  // Page 5: TX_RX_DATA (0x14) & AC/DC Timing Parameters
  `2.6 TX_RX_DATA — Serial Transmit / Receive Data Window
Address Offset: 0x14 | Width: 32 bits | Reset Value: null (Not specified in spec — FIFO window)
Description: Writing pushes a frame to TX FIFO; reading pops the oldest frame from RX FIFO.

Bitfields for TX_RX_DATA (Offset 0x14):
- Bits [31:9] RESERVED (Access: RESERVED, Reset: 0x0): Reserved bits.
- Bit  [8]    PARITY_BIT (Access: RO, Reset: null): Received 9th parity bit from RX FIFO top.
- Bits [7:0]  DATA_BYTE (Access: RW, Reset: null): 8-bit serial payload written to TX FIFO or read from RX FIFO.

3. AC & Interface Timing Specifications
Table 3-1: Electrical & Clock Timing Parameters (VDD = 0.85V, Tj = -40C to +125C)
- f_PCLK: APB Bus Clock Frequency | Min: 10 | Typ: 100 | Max: 400 | Unit: MHz | Condition: Synchronous APB4 mode
- f_BAUD_MAX: Maximum Serial Baud Rate | Min: — | Typ: 12.5 | Max: 25.0 | Unit: Mbps | Condition: OVERSAMPLE = 4x (0x2)
- t_TX_LAT: TX FIFO Write to Serial Start Bit Latency | Min: 2 | Typ: 3 | Max: 4 | Unit: cycles | Condition: TX_EN = 1, CTS_N = 0
- t_IRQ_CLR: W1C Status Clear to IRQ_O Deassertion | Min: 1 | Typ: 1 | Max: 2 | Unit: cycles | Condition: APB PENABLE high`,

  // Page 6: Normative Functional & Verification Requirements
  `4. Normative Functional & Safety Requirements
[REQ-UART-003] (Section 4.1) The transmitter shall assert STATUS.TX_EMPTY within 1 PCLK cycle after the final stop bit of the last character shifts out.
[REQ-UART-004] (Section 4.2) Writing 1 to STATUS.OVERRUN_ERR, STATUS.PARITY_ERR, or STATUS.FRAMING_ERR shall clear the respective sticky bit without modifying adjacent status bits.
[REQ-UART-005] (Section 4.3) When CTRL.FLOW_CTRL_EN is set to 1, the receiver shall deassert RTS_N within 2 PCLK cycles when RX FIFO occupancy reaches RX_TRIG_LVL.
[REQ-UART-006] (Section 4.4) Reset assertion (PRESETn = 0) shall deterministically initialize CTRL to 0x00000001, STATUS to 0x00000003, and BAUD_DIV to 0x00000068.`,
];

/**
 * Generates a real multi-page PDF document in the browser using pdf-lib
 * so the PDF.js viewer can render it, jump to pages, and highlight verbatim quotes.
 */
export async function generateDemoPdfBytes(
  pagesText: string[] = DEMO_SPEC_PAGES_TEXT,
  headerTitle = 'SPECSYNC SILICON DATASHEET // HARDWARE IP SPECIFICATION'
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Courier);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  for (let i = 0; i < pagesText.length; i++) {
    const page = pdfDoc.addPage([612, 792]); // Letter size
    const { width, height } = page.getSize();

    // Header bar
    page.drawRectangle({
      x: 36,
      y: height - 54,
      width: width - 72,
      height: 24,
      color: rgb(0.08, 0.12, 0.2),
    });
    page.drawText(headerTitle.slice(0, 68), {
      x: 44,
      y: height - 46,
      size: 9,
      font: fontBold,
      color: rgb(0.85, 0.92, 1),
    });
    page.drawText(`Page ${i + 1} of ${pagesText.length}`, {
      x: width - 115,
      y: height - 46,
      size: 9,
      font: fontBold,
      color: rgb(0.6, 0.8, 1),
    });

    const rawLines = pagesText[i].split('\n');
    let yCursor = height - 80;

    for (const rawLine of rawLines) {
      const chunks: string[] = [];
      if (rawLine.length <= 84) {
        chunks.push(rawLine);
      } else {
        let rem = rawLine;
        while (rem.length > 84) {
          let splitIdx = rem.lastIndexOf(' ', 84);
          if (splitIdx <= 0) splitIdx = 84;
          chunks.push(rem.slice(0, splitIdx));
          rem = '  ' + rem.slice(splitIdx).trimStart();
        }
        if (rem) chunks.push(rem);
      }

      for (const line of chunks) {
        const isHeading = /^[0-9]+\.[0-9]*\s+|^[A-Z0-9_]+\s+—/.test(line.trim());
        page.drawText(line, {
          x: 40,
          y: yCursor,
          size: isHeading ? 10.5 : 9,
          font: isHeading ? fontBold : fontRegular,
          color: isHeading ? rgb(0.05, 0.15, 0.35) : rgb(0.12, 0.15, 0.2),
        });
        yCursor -= isHeading ? 18 : 14;
      }
    }

    page.drawText(`CONFIDENTIAL — SEMICONDUCTOR IP CORE SPECIFICATION — PAGE ${i + 1}`, {
      x: 40,
      y: 28,
      size: 8,
      font: fontRegular,
      color: rgb(0.45, 0.5, 0.58),
    });
  }

  return await pdfDoc.save();
}

export const DEMO_DOCUMENT_MAP: DocumentMap = {
  ipName: 'AXI_UART_16550',
  ipVersion: 'v1.4',
  busWidth: 32,
  baseAddress: '0x40001000',
  totalPages: 6,
  sections: [
    {
      id: 'sec-1',
      title: '1. Architectural Overview & Bus Requirements',
      startPage: 1,
      endPage: 1,
      hasRegisters: false,
      hasTiming: false,
      hasRequirements: true,
      summary: 'Block architecture, 32-bit APB4/AXI4-Lite bus alignment, and slave error requirements.',
    },
    {
      id: 'sec-2',
      title: '2.1 - 2.3 Register Map: CTRL, STATUS, BAUD_DIV',
      startPage: 2,
      endPage: 3,
      hasRegisters: true,
      hasTiming: false,
      hasRequirements: false,
      summary: 'Control register (0x00), Line/FIFO status register (0x04), and fractional baud rate divisor (0x08).',
    },
    {
      id: 'sec-3',
      title: '2.4 - 2.6 Register Map: FIFO_CTRL, INT_EN, TX_RX_DATA & Timing',
      startPage: 4,
      endPage: 5,
      hasRegisters: true,
      hasTiming: true,
      hasRequirements: false,
      summary: 'FIFO watermark control (0x0C), interrupt mask (0x10), data window (0x14), and AC timing table.',
    },
    {
      id: 'sec-4',
      title: '4. Normative Functional & Safety Requirements',
      startPage: 6,
      endPage: 6,
      hasRegisters: false,
      hasTiming: false,
      hasRequirements: true,
      summary: 'Normative shall/must requirements for TX_EMPTY latency, W1C clearing, and hardware reset.',
    },
  ],
};

export const DEMO_IP_SPEC: IPSpec = {
  name: 'AXI_UART_16550',
  version: 'v1.4',
  busWidth: 32,
  baseAddress: '0x40001000',
  registers: [
    {
      id: 'reg-1-ctrl',
      name: 'CTRL',
      offset: '0x00',
      width: 32,
      description: 'Configures transmitter/receiver enable states, parity mode, loopback, and oversampling ratio.',
      resetValue: '0x00000001',
      confidence: 0.99,
      repairStatus: 'original',
      reviewStatus: 'accepted',
      evidence: {
        page: 2,
        quote: '2.1 CTRL — UART Master Control Register | Address Offset: 0x00 | Width: 32 bits | Reset Value: 0x00000001',
      },
      fields: [
        {
          name: 'RESERVED',
          msb: 31,
          lsb: 8,
          access: 'RESERVED',
          resetValue: '0x0',
          description: 'Reserved bits, read as 0, write 0.',
          enumValues: [],
          evidence: { page: 2, quote: 'Bits [31:8] RESERVED (Access: RESERVED, Reset: 0x0)' },
        },
        {
          name: 'PARITY_MODE',
          msb: 7,
          lsb: 6,
          access: 'RW',
          resetValue: '0x0',
          description: 'Selects serial parity generation and checking mode.',
          enumValues: [
            { name: 'NONE', value: '0x0', description: 'No parity bit transmitted' },
            { name: 'ODD', value: '0x1', description: 'Odd parity checking and generation' },
            { name: 'EVEN', value: '0x2', description: 'Even parity checking and generation' },
            { name: 'FORCE_0', value: '0x3', description: 'Sticky mark/space parity' },
          ],
          evidence: { page: 2, quote: 'Bits [7:6] PARITY_MODE (Access: RW, Reset: 0x0)' },
        },
        {
          name: 'OVERSAMPLE',
          msb: 5,
          lsb: 4,
          access: 'RW',
          resetValue: '0x0',
          description: 'Receiver oversampling clock ratio (0x0=16x, 0x1=8x, 0x2=4x).',
          enumValues: [
            { name: 'OS_16X', value: '0x0' },
            { name: 'OS_8X', value: '0x1' },
            { name: 'OS_4X', value: '0x2' },
          ],
          evidence: { page: 2, quote: 'Bits [5:4] OVERSAMPLE (Access: RW, Reset: 0x0)' },
        },
        {
          name: 'LOOPBACK_EN',
          msb: 3,
          lsb: 3,
          access: 'RW',
          resetValue: '0x0',
          description: 'Internal diagnostic TX-to-RX loopback enable.',
          enumValues: [],
          evidence: { page: 2, quote: 'Bit [3] LOOPBACK_EN (Access: RW, Reset: 0x0)' },
        },
        {
          name: 'FLOW_CTRL_EN',
          msb: 2,
          lsb: 2,
          access: 'RW',
          resetValue: '0x0',
          description: 'Hardware RTS/CTS automatic flow control enable.',
          enumValues: [],
          evidence: { page: 2, quote: 'Bit [2] FLOW_CTRL_EN (Access: RW, Reset: 0x0)' },
        },
        {
          name: 'RX_EN',
          msb: 1,
          lsb: 1,
          access: 'RW',
          resetValue: '0x0',
          description: 'Receiver state machine enable.',
          enumValues: [],
          evidence: { page: 2, quote: 'Bit [1] RX_EN (Access: RW, Reset: 0x0)' },
        },
        {
          name: 'TX_EN',
          msb: 0,
          lsb: 0,
          access: 'RW',
          resetValue: '0x1',
          description: 'Transmitter state machine enable (enabled by default at reset).',
          enumValues: [],
          evidence: { page: 2, quote: 'Bit [0] TX_EN (Access: RW, Reset: 0x1)' },
        },
      ],
    },
    {
      id: 'reg-2-status',
      name: 'STATUS',
      offset: '0x04',
      width: 32,
      description: 'Real-time transmitter/receiver readiness and sticky framing/overrun error indicators.',
      resetValue: '0x00000003',
      confidence: 0.98,
      repairStatus: 'original',
      reviewStatus: 'accepted',
      evidence: {
        page: 3,
        quote: '2.2 STATUS — Line & FIFO Status Register | Address Offset: 0x04 | Width: 32 bits | Reset Value: 0x00000003',
      },
      fields: [
        {
          name: 'RESERVED',
          msb: 31,
          lsb: 6,
          access: 'RESERVED',
          resetValue: '0x0',
          description: 'Reserved bits.',
          enumValues: [],
          evidence: { page: 3, quote: 'Bits [31:6] RESERVED (Access: RESERVED, Reset: 0x0)' },
        },
        {
          name: 'FRAMING_ERR',
          msb: 5,
          lsb: 5,
          access: 'W1C',
          resetValue: '0x0',
          description: 'Sticky stop-bit framing error flag. Write 1 to clear.',
          enumValues: [],
          evidence: { page: 3, quote: 'Bit [5] FRAMING_ERR (Access: W1C, Reset: 0x0)' },
        },
        {
          name: 'PARITY_ERR',
          msb: 4,
          lsb: 4,
          access: 'W1C',
          resetValue: '0x0',
          description: 'Sticky parity mismatch flag. Write 1 to clear.',
          enumValues: [],
          evidence: { page: 3, quote: 'Bit [4] PARITY_ERR (Access: W1C, Reset: 0x0)' },
        },
        {
          name: 'OVERRUN_ERR',
          msb: 3,
          lsb: 3,
          access: 'W1C',
          resetValue: '0x0',
          description: 'RX FIFO overrun error flag. Write 1 to clear.',
          enumValues: [],
          evidence: { page: 3, quote: 'Bit [3] OVERRUN_ERR (Access: W1C, Reset: 0x0)' },
        },
        {
          name: 'RX_FULL',
          msb: 2,
          lsb: 2,
          access: 'RO',
          resetValue: '0x0',
          description: 'Asserted when RX FIFO contains 64 entries.',
          enumValues: [],
          evidence: { page: 3, quote: 'Bit [2] RX_FULL (Access: RO, Reset: 0x0)' },
        },
        {
          name: 'TX_EMPTY',
          msb: 1,
          lsb: 1,
          access: 'RO',
          resetValue: '0x1',
          description: 'Asserted when TX FIFO is completely empty after reset.',
          enumValues: [],
          evidence: { page: 3, quote: 'Bit [1] TX_EMPTY (Access: RO, Reset: 0x1)' },
        },
        {
          name: 'READY',
          msb: 0,
          lsb: 0,
          access: 'RO',
          resetValue: '0x1',
          description: 'Transceiver clock domain ready status (resets to 0x1).',
          enumValues: [],
          evidence: { page: 3, quote: 'Bit [0] READY (Access: RO, Reset: 0x1)' },
        },
      ],
    },
    {
      id: 'reg-3-baud-div',
      name: 'BAUD_DIV',
      offset: '0x08',
      width: 32,
      description: 'Configures 16-bit integer and 6-bit fractional baud clock divider.',
      resetValue: '0x00000068',
      confidence: 0.96,
      repairStatus: 'auto-fixed',
      reviewStatus: 'pending',
      evidence: {
        page: 3,
        quote: '2.3 BAUD_DIV — Fractional Baud Rate Divisor Register | Address Offset: 0x08 | Reset Value: 0x00000068',
      },
      repairHistory: [
        {
          attempt: 1,
          timestamp: '2026-10-26T22:58:10.000Z',
          errorsFixed: [
            '[INVALID_BIT_ORDER] Field BAUD_DIV.FRAC_DIV has inverted bit range [16:21] (msb 16 < lsb 21).',
          ],
          remainingErrors: [],
          previousRegister: {
            name: 'BAUD_DIV',
            offset: '0x08',
            width: 32,
            description: 'Configures 16-bit integer and 6-bit fractional baud clock divider.',
            resetValue: '0x00000068',
            confidence: 0.88,
            evidence: {
              page: 3,
              quote: 'Bits [21:16] FRAC_DIV (Access: RW, Reset: 0x0): 6-bit fractional baud rate divisor',
            },
            fields: [
              {
                name: 'RESERVED',
                msb: 31,
                lsb: 22,
                access: 'RESERVED',
                resetValue: '0x0',
                description: 'Reserved bits.',
                enumValues: [],
                evidence: { page: 3, quote: 'Bits [31:22] RESERVED' },
              },
              {
                name: 'FRAC_DIV',
                msb: 16,
                lsb: 21,
                access: 'RW',
                resetValue: '0x0',
                description: '6-bit fractional baud rate divisor (N/64).',
                enumValues: [],
                evidence: { page: 3, quote: 'Bits [21:16] FRAC_DIV (Access: RW, Reset: 0x0)' },
              },
              {
                name: 'INT_DIV',
                msb: 15,
                lsb: 0,
                access: 'RW',
                resetValue: '0x0068',
                description: '16-bit integer baud rate divisor.',
                enumValues: [],
                evidence: { page: 3, quote: 'Bits [15:0] INT_DIV (Access: RW, Reset: 0x0068)' },
              },
            ],
          },
        },
      ],
      fields: [
        {
          name: 'RESERVED',
          msb: 31,
          lsb: 22,
          access: 'RESERVED',
          resetValue: '0x0',
          description: 'Reserved bits.',
          enumValues: [],
          evidence: { page: 3, quote: 'Bits [31:22] RESERVED (Access: RESERVED, Reset: 0x0)' },
        },
        {
          name: 'FRAC_DIV',
          msb: 21,
          lsb: 16,
          access: 'RW',
          resetValue: '0x0',
          description: '6-bit fractional baud rate divisor (N/64).',
          enumValues: [],
          evidence: { page: 3, quote: 'Bits [21:16] FRAC_DIV (Access: RW, Reset: 0x0)' },
        },
        {
          name: 'INT_DIV',
          msb: 15,
          lsb: 0,
          access: 'RW',
          resetValue: '0x0068',
          description: '16-bit integer baud rate divisor (defaults to 0x0068 for 115200 baud @ 100MHz).',
          enumValues: [],
          evidence: { page: 3, quote: 'Bits [15:0] INT_DIV (Access: RW, Reset: 0x0068)' },
        },
      ],
    },
    {
      id: 'reg-4-fifo-ctrl',
      name: 'FIFO_CTRL',
      offset: '0x0C',
      width: 32,
      description: 'Controls TX/RX FIFO watermark trigger levels and one-shot FIFO clear strobes.',
      resetValue: '0x00000200',
      confidence: 0.94,
      repairStatus: 'original',
      reviewStatus: 'pending',
      evidence: {
        page: 4,
        quote: '2.4 FIFO_CTRL — TX/RX FIFO Threshold & Flush Control Register | Address Offset: 0x0C | Reset Value: 0x00000200',
      },
      fields: [
        {
          name: 'RX_TRIG_LVL',
          msb: 11,
          lsb: 8,
          access: 'RW',
          resetValue: '0x2',
          description: 'RX FIFO interrupt watermark level (0x0=1B, 0x1=16B, 0x2=32B, 0x3=56B).',
          enumValues: [
            { name: 'TRIG_1B', value: '0x0' },
            { name: 'TRIG_16B', value: '0x1' },
            { name: 'TRIG_32B', value: '0x2' },
            { name: 'TRIG_56B', value: '0x3' },
          ],
          evidence: { page: 4, quote: 'Bits [11:8] RX_TRIG_LVL (Access: RW, Reset: 0x2)' },
        },
        {
          name: 'TX_TRIG_LVL',
          msb: 7,
          lsb: 4,
          access: 'RW',
          resetValue: '0x0',
          description: 'TX FIFO empty watermark level.',
          enumValues: [],
          evidence: { page: 4, quote: 'Bits [7:4] TX_TRIG_LVL (Access: RW, Reset: 0x0)' },
        },
        {
          name: 'RX_FIFO_CLR',
          msb: 1,
          lsb: 1,
          access: 'W1S',
          resetValue: '0x0',
          description: 'Self-clearing RX FIFO flush strobe.',
          enumValues: [],
          evidence: { page: 4, quote: 'Bit [1] RX_FIFO_CLR (Access: W1S, Reset: 0x0)' },
        },
        {
          name: 'TX_FIFO_CLR',
          msb: 0,
          lsb: 0,
          access: 'W1S',
          resetValue: '0x0',
          description: 'Self-clearing TX FIFO flush strobe.',
          enumValues: [],
          evidence: { page: 4, quote: 'Bit [0] TX_FIFO_CLR (Access: W1S, Reset: 0x0)' },
        },
      ],
    },
    {
      id: 'reg-5-int-en',
      name: 'INT_EN',
      offset: '0x10',
      width: 32,
      description: 'Enables individual interrupt sources to drive the system IRQ line.',
      resetValue: '0x00000000',
      confidence: 0.99,
      repairStatus: 'original',
      reviewStatus: 'accepted',
      evidence: {
        page: 4,
        quote: '2.5 INT_EN — Interrupt Mask & Enable Register | Address Offset: 0x10 | Reset Value: 0x00000000',
      },
      fields: [
        {
          name: 'RESERVED',
          msb: 31,
          lsb: 4,
          access: 'RESERVED',
          resetValue: '0x0',
          description: 'Reserved bits.',
          enumValues: [],
          evidence: { page: 4, quote: 'Bits [31:4] RESERVED (Access: RESERVED, Reset: 0x0)' },
        },
        {
          name: 'ERR_INT_EN',
          msb: 3,
          lsb: 3,
          access: 'RW',
          resetValue: '0x0',
          description: 'Enable framing/parity/overrun error interrupt.',
          enumValues: [],
          evidence: { page: 4, quote: 'Bit [3] ERR_INT_EN (Access: RW, Reset: 0x0)' },
        },
        {
          name: 'TIMEOUT_INT_EN',
          msb: 2,
          lsb: 2,
          access: 'RW',
          resetValue: '0x0',
          description: 'Enable RX character timeout interrupt.',
          enumValues: [],
          evidence: { page: 4, quote: 'Bit [2] TIMEOUT_INT_EN (Access: RW, Reset: 0x0)' },
        },
        {
          name: 'RX_WM_INT_EN',
          msb: 1,
          lsb: 1,
          access: 'RW',
          resetValue: '0x0',
          description: 'Enable RX FIFO watermark reached interrupt.',
          enumValues: [],
          evidence: { page: 4, quote: 'Bit [1] RX_WM_INT_EN (Access: RW, Reset: 0x0)' },
        },
        {
          name: 'TX_WM_INT_EN',
          msb: 0,
          lsb: 0,
          access: 'RW',
          resetValue: '0x0',
          description: 'Enable TX FIFO watermark reached interrupt.',
          enumValues: [],
          evidence: { page: 4, quote: 'Bit [0] TX_WM_INT_EN (Access: RW, Reset: 0x0)' },
        },
      ],
    },
    {
      id: 'reg-6-tx-rx-data',
      name: 'TX_RX_DATA',
      offset: '0x14',
      width: 32,
      description: 'Writing pushes a frame to TX FIFO; reading pops the oldest frame from RX FIFO.',
      resetValue: null,
      confidence: 0.95,
      repairStatus: 'original',
      reviewStatus: 'accepted',
      evidence: {
        page: 5,
        quote: '2.6 TX_RX_DATA — Serial Transmit / Receive Data Window | Address Offset: 0x14 | Reset Value: null',
      },
      fields: [
        {
          name: 'RESERVED',
          msb: 31,
          lsb: 9,
          access: 'RESERVED',
          resetValue: '0x0',
          description: 'Reserved bits.',
          enumValues: [],
          evidence: { page: 5, quote: 'Bits [31:9] RESERVED (Access: RESERVED, Reset: 0x0)' },
        },
        {
          name: 'PARITY_BIT',
          msb: 8,
          lsb: 8,
          access: 'RO',
          resetValue: null,
          description: 'Received 9th parity bit from RX FIFO top.',
          enumValues: [],
          evidence: { page: 5, quote: 'Bit [8] PARITY_BIT (Access: RO, Reset: null)' },
        },
        {
          name: 'DATA_BYTE',
          msb: 7,
          lsb: 0,
          access: 'RW',
          resetValue: null,
          description: '8-bit serial payload written to TX FIFO or read from RX FIFO.',
          enumValues: [],
          evidence: { page: 5, quote: 'Bits [7:0] DATA_BYTE (Access: RW, Reset: null)' },
        },
      ],
    },
  ],
  timingParameters: [
    {
      name: 'f_PCLK',
      min: '10',
      typ: '100',
      max: '400',
      unit: 'MHz',
      condition: 'Synchronous APB4 mode, VDD=0.85V',
      evidence: {
        page: 5,
        quote: 'f_PCLK: APB Bus Clock Frequency | Min: 10 | Typ: 100 | Max: 400 | Unit: MHz',
      },
    },
    {
      name: 'f_BAUD_MAX',
      min: null,
      typ: '12.5',
      max: '25.0',
      unit: 'Mbps',
      condition: 'OVERSAMPLE = 4x (0x2)',
      evidence: {
        page: 5,
        quote: 'f_BAUD_MAX: Maximum Serial Baud Rate | Min: — | Typ: 12.5 | Max: 25.0 | Unit: Mbps',
      },
    },
    {
      name: 't_TX_LAT',
      min: '2',
      typ: '3',
      max: '4',
      unit: 'cycles',
      condition: 'TX_EN = 1, CTS_N = 0',
      evidence: {
        page: 5,
        quote: 't_TX_LAT: TX FIFO Write to Serial Start Bit Latency | Min: 2 | Typ: 3 | Max: 4 | Unit: cycles',
      },
    },
    {
      name: 't_IRQ_CLR',
      min: '1',
      typ: '1',
      max: '2',
      unit: 'cycles',
      condition: 'W1C Status Clear to IRQ_O Deassertion',
      evidence: {
        page: 5,
        quote: 't_IRQ_CLR: W1C Status Clear to IRQ_O Deassertion | Min: 1 | Typ: 1 | Max: 2 | Unit: cycles',
      },
    },
  ],
  requirements: [
    {
      id: 'REQ-UART-001',
      section: '1.2',
      page: 1,
      text: 'The AXI_UART_16550 slave interface shall respond to unmapped register offsets within the 4 KB aperture with zero read data and PSLVERR asserted.',
    },
    {
      id: 'REQ-UART-002',
      section: '1.3',
      page: 1,
      text: 'All control and status registers shall support 32-bit aligned word accesses aligned to a 4-byte boundary.',
    },
    {
      id: 'REQ-UART-003',
      section: '4.1',
      page: 6,
      text: 'The transmitter shall assert STATUS.TX_EMPTY within 1 PCLK cycle after the final stop bit of the last character shifts out.',
    },
    {
      id: 'REQ-UART-004',
      section: '4.2',
      page: 6,
      text: 'Writing 1 to STATUS.OVERRUN_ERR, STATUS.PARITY_ERR, or STATUS.FRAMING_ERR shall clear the respective sticky bit without modifying adjacent status bits.',
    },
    {
      id: 'REQ-UART-005',
      section: '4.3',
      page: 6,
      text: 'When CTRL.FLOW_CTRL_EN is set to 1, the receiver shall deassert RTS_N within 2 PCLK cycles when RX FIFO occupancy reaches RX_TRIG_LVL.',
    },
    {
      id: 'REQ-UART-006',
      section: '4.4',
      page: 6,
      text: 'Reset assertion (PRESETn = 0) shall deterministically initialize CTRL to 0x00000001, STATUS to 0x00000003, and BAUD_DIV to 0x00000068.',
    },
  ],
};

export const DEMO_RTL_CODE = `// ============================================================================
// Module: axi_uart_16550_csr.sv
// Description: Register file RTL for AXI_UART_16550 (contains bugs vs Spec v1.4)
// ============================================================================
module axi_uart_16550_csr (
  input  logic        pclk,
  input  logic        preset_n,
  input  logic [11:0] paddr,
  input  logic        psel,
  input  logic        penable,
  input  logic        pwrite,
  input  logic [31:0] pwdata,
  output logic [31:0] prdata
);

  // Register Address Offsets
  localparam [7:0] ADDR_CTRL       = 8'h00;
  localparam [7:0] ADDR_STATUS     = 8'h04;
  localparam [7:0] ADDR_BAUD_DIV   = 8'h08;
  localparam [7:0] ADDR_FIFO_CTRL  = 8'h0C;
  localparam [7:0] ADDR_INT_EN     = 8'h10;
  localparam [7:0] ADDR_TX_RX_DATA = 8'h14;
  localparam [7:0] ADDR_DBG_SCRATCH = 8'h18; // Undocumented debug register in RTL!

  // Register Reset Parameters
  localparam [31:0] RST_CTRL      = 32'h0000_0001;
  localparam [31:0] RST_STATUS    = 32'h0000_0002; // BUG: READY bit[0] resets to 0 instead of 1!
  localparam [31:0] RST_BAUD_DIV  = 32'h0000_0068;
  localparam [31:0] RST_FIFO_CTRL = 32'h0000_0200;
  localparam [31:0] RST_INT_EN    = 32'h0000_0000;

  // CTRL (0x00) fields
  // @field CTRL.PARITY_MODE [7:6] access=RW reset=0x0
  // @field CTRL.OVERSAMPLE [5:4] access=RW reset=0x0
  // @field CTRL.LOOPBACK_EN [3:3] access=RW reset=0x0
  // @field CTRL.FLOW_CTRL_EN [2:2] access=RW reset=0x0
  // @field CTRL.RX_EN [1:1] access=RW reset=0x0
  // @field CTRL.TX_EN [0:0] access=RW reset=0x1

  // STATUS (0x04) fields
  // @field STATUS.FRAMING_ERR [5:5] access=W1C reset=0x0
  // @field STATUS.PARITY_ERR [4:4] access=RW reset=0x0
  // @field STATUS.OVERRUN_ERR [3:3] access=W1C reset=0x0
  // @field STATUS.RX_FULL [2:2] access=RO reset=0x0
  // @field STATUS.TX_EMPTY [1:1] access=RO reset=0x1
  // @field STATUS.READY [0:0] access=RO reset=0x0

  // BAUD_DIV (0x08) fields
  // @field BAUD_DIV.FRAC_DIV [21:16] access=RW reset=0x0
  // @field BAUD_DIV.INT_DIV [15:0] access=RW reset=0x0068

  // FIFO_CTRL (0x0C) fields — Note BUG: RX_TRIG_LVL wired as 3-bit [10:8] instead of [11:8]!
  // @field FIFO_CTRL.RX_TRIG_LVL [10:8] access=RW reset=0x2
  // @field FIFO_CTRL.TX_TRIG_LVL [7:4] access=RW reset=0x0
  // @field FIFO_CTRL.RX_FIFO_CLR [1:1] access=W1S reset=0x0
  // @field FIFO_CTRL.TX_FIFO_CLR [0:0] access=W1S reset=0x0

  // INT_EN (0x10) fields
  // @field INT_EN.ERR_INT_EN [3:3] access=RW reset=0x0
  // @field INT_EN.TIMEOUT_INT_EN [2:2] access=RW reset=0x0
  // @field INT_EN.RX_WM_INT_EN [1:1] access=RW reset=0x0
  // @field INT_EN.TX_WM_INT_EN [0:0] access=RW reset=0x0

  // TX_RX_DATA (0x14) fields
  // @field TX_RX_DATA.PARITY_BIT [8:8] access=RO
  // @field TX_RX_DATA.DATA_BYTE [7:0] access=RW
endmodule
`;

export const DEMO_C_HEADER_CODE = `/**
 * @file uart_fw_regs.h
 * @brief Legacy Firmware C Header for AXI_UART_16550 (contains drift vs Spec v1.4)
 */
#ifndef _UART_FW_REGS_H_
#define _UART_FW_REGS_H_

#define AXI_UART_BASE_ADDR                  (0x40001000UL)

/* CTRL Register (0x00) */
#define AXI_UART_CTRL_OFFSET                (0x00U)
#define AXI_UART_CTRL_RESET                 (0x00000001UL)
#define AXI_UART_CTRL_PARITY_MODE_SHIFT     (6U)
#define AXI_UART_CTRL_PARITY_MODE_MASK      (0x000000C0UL)
/* BUG in Header: OVERSAMPLE_MASK is 3 bits [6:4] = 0x70 instead of [5:4] = 0x30! */
#define AXI_UART_CTRL_OVERSAMPLE_SHIFT      (4U)
#define AXI_UART_CTRL_OVERSAMPLE_MASK       (0x00000070UL)
#define AXI_UART_CTRL_LOOPBACK_EN_SHIFT     (3U)
#define AXI_UART_CTRL_LOOPBACK_EN_MASK      (0x00000008UL)
#define AXI_UART_CTRL_FLOW_CTRL_EN_SHIFT    (2U)
#define AXI_UART_CTRL_FLOW_CTRL_EN_MASK     (0x00000004UL)
#define AXI_UART_CTRL_RX_EN_SHIFT           (1U)
#define AXI_UART_CTRL_RX_EN_MASK            (0x00000002UL)
#define AXI_UART_CTRL_TX_EN_SHIFT           (0U)
#define AXI_UART_CTRL_TX_EN_MASK            (0x00000001UL)

/* STATUS Register (0x04) */
#define AXI_UART_STATUS_OFFSET              (0x04U)
#define AXI_UART_STATUS_RESET               (0x00000003UL)
#define AXI_UART_STATUS_FRAMING_ERR_SHIFT   (5U)
#define AXI_UART_STATUS_FRAMING_ERR_MASK    (0x00000020UL)
#define AXI_UART_STATUS_PARITY_ERR_SHIFT    (4U)
#define AXI_UART_STATUS_PARITY_ERR_MASK     (0x00000010UL)
#define AXI_UART_STATUS_OVERRUN_ERR_SHIFT   (3U)
#define AXI_UART_STATUS_OVERRUN_ERR_MASK    (0x00000008UL)
#define AXI_UART_STATUS_RX_FULL_SHIFT       (2U)
#define AXI_UART_STATUS_RX_FULL_MASK        (0x00000004UL)
#define AXI_UART_STATUS_TX_EMPTY_SHIFT      (1U)
#define AXI_UART_STATUS_TX_EMPTY_MASK       (0x00000002UL)
#define AXI_UART_STATUS_READY_SHIFT         (0U)
#define AXI_UART_STATUS_READY_MASK          (0x00000001UL)
#define AXI_UART_STATUS_READY_RESET         (0x1U)

/* BAUD_DIV Register (0x08) - BUG in Header: RESET is 0x0034 instead of 0x0068 */
#define AXI_UART_BAUD_DIV_OFFSET            (0x08U)
#define AXI_UART_BAUD_DIV_RESET             (0x00000034UL)
#define AXI_UART_BAUD_DIV_FRAC_DIV_SHIFT    (16U)
#define AXI_UART_BAUD_DIV_FRAC_DIV_MASK     (0x003F0000UL)
#define AXI_UART_BAUD_DIV_INT_DIV_SHIFT     (0U)
#define AXI_UART_BAUD_DIV_INT_DIV_MASK      (0x0000FFFFUL)

/* FIFO_CTRL Register (0x0C) */
#define AXI_UART_FIFO_CTRL_OFFSET           (0x0CU)
#define AXI_UART_FIFO_CTRL_RESET            (0x00000200UL)
#define AXI_UART_FIFO_CTRL_RX_TRIG_LVL_SHIFT (8U)
#define AXI_UART_FIFO_CTRL_RX_TRIG_LVL_MASK  (0x00000F00UL)
#define AXI_UART_FIFO_CTRL_TX_TRIG_LVL_SHIFT (4U)
#define AXI_UART_FIFO_CTRL_TX_TRIG_LVL_MASK  (0x000000F0UL)
#define AXI_UART_FIFO_CTRL_RX_FIFO_CLR_SHIFT (1U)
#define AXI_UART_FIFO_CTRL_RX_FIFO_CLR_MASK  (0x00000002UL)
#define AXI_UART_FIFO_CTRL_TX_FIFO_CLR_SHIFT (0U)
#define AXI_UART_FIFO_CTRL_TX_FIFO_CLR_MASK  (0x00000001UL)

/* INT_EN Register - BUG in Header: OFFSET is 0x14 instead of 0x10! */
#define AXI_UART_INT_EN_OFFSET              (0x14U)
#define AXI_UART_INT_EN_RESET               (0x00000000UL)
#define AXI_UART_INT_EN_ERR_INT_EN_SHIFT    (3U)
#define AXI_UART_INT_EN_ERR_INT_EN_MASK     (0x00000008UL)
#define AXI_UART_INT_EN_TIMEOUT_INT_EN_SHIFT (2U)
#define AXI_UART_INT_EN_TIMEOUT_INT_EN_MASK (0x00000004UL)
#define AXI_UART_INT_EN_RX_WM_INT_EN_SHIFT  (1U)
#define AXI_UART_INT_EN_RX_WM_INT_EN_MASK   (0x00000002UL)
#define AXI_UART_INT_EN_TX_WM_INT_EN_SHIFT  (0U)
#define AXI_UART_INT_EN_TX_WM_INT_EN_MASK   (0x00000001UL)

/* TX_RX_DATA Register (0x14) */
#define AXI_UART_TX_RX_DATA_OFFSET          (0x14U)
#define AXI_UART_TX_RX_DATA_PARITY_BIT_SHIFT (8U)
#define AXI_UART_TX_RX_DATA_PARITY_BIT_MASK  (0x00000100UL)
#define AXI_UART_TX_RX_DATA_DATA_BYTE_SHIFT  (0U)
#define AXI_UART_TX_RX_DATA_DATA_BYTE_MASK   (0x000000FFUL)

#endif /* _UART_FW_REGS_H_ */
`;

export const DEMO_IP_SPEC_V2: IPSpec = {
  ...DEMO_IP_SPEC,
  version: 'v2.0',
  registers: [
    {
      ...DEMO_IP_SPEC.registers[0],
      fields: [
        {
          name: 'RESERVED',
          msb: 31,
          lsb: 9,
          access: 'RESERVED',
          resetValue: '0x0',
          description: 'Reserved bits.',
          enumValues: [],
          evidence: { page: 2, quote: 'Bits [31:9] RESERVED' },
        },
        {
          name: 'DMA_MODE_EN',
          msb: 8,
          lsb: 8,
          access: 'RW',
          resetValue: '0x0',
          description: 'AXI-Stream DMA handshake enable (Added in v2.0).',
          enumValues: [],
          evidence: { page: 2, quote: 'Bit [8] DMA_MODE_EN (Access: RW, Reset: 0x0)' },
        },
        ...DEMO_IP_SPEC.registers[0].fields.slice(1),
      ],
    },
    DEMO_IP_SPEC.registers[1],
    {
      ...DEMO_IP_SPEC.registers[2],
      resetValue: '0x00000034',
      fields: [
        {
          name: 'RESERVED',
          msb: 31,
          lsb: 24,
          access: 'RESERVED',
          resetValue: '0x0',
          description: 'Reserved bits.',
          enumValues: [],
          evidence: { page: 3, quote: 'Bits [31:24] RESERVED' },
        },
        {
          name: 'FRAC_DIV',
          msb: 23,
          lsb: 16,
          access: 'RW',
          resetValue: '0x0',
          description: '8-bit fractional baud rate divisor (N/256, widened in v2.0).',
          enumValues: [],
          evidence: { page: 3, quote: 'Bits [23:16] FRAC_DIV (Access: RW, Reset: 0x0)' },
        },
        {
          name: 'INT_DIV',
          msb: 15,
          lsb: 0,
          access: 'RW',
          resetValue: '0x0034',
          description: '16-bit integer baud rate divisor (defaults to 0x0034 for 200MHz PCLK).',
          enumValues: [],
          evidence: { page: 3, quote: 'Bits [15:0] INT_DIV (Access: RW, Reset: 0x0034)' },
        },
      ],
    },
    DEMO_IP_SPEC.registers[3],
    DEMO_IP_SPEC.registers[4],
    DEMO_IP_SPEC.registers[5],
    {
      id: 'reg-7-dma-cfg',
      name: 'DMA_CFG',
      offset: '0x18',
      width: 32,
      description: 'DMA Burst Length & Channel Enable Register (Added in v2.0).',
      resetValue: '0x00000004',
      confidence: 0.99,
      repairStatus: 'original',
      reviewStatus: 'accepted',
      evidence: {
        page: 5,
        quote: '2.7 DMA_CFG — DMA Burst Length & Channel Enable | Address Offset: 0x18 | Reset: 0x00000004',
      },
      fields: [
        {
          name: 'RESERVED',
          msb: 31,
          lsb: 6,
          access: 'RESERVED',
          resetValue: '0x0',
          description: 'Reserved',
          enumValues: [],
          evidence: { page: 5, quote: 'Bits [31:6] RESERVED' },
        },
        {
          name: 'BURST_LEN',
          msb: 5,
          lsb: 2,
          access: 'RW',
          resetValue: '0x1',
          description: 'DMA burst beat count (0x1 = 4 beats).',
          enumValues: [],
          evidence: { page: 5, quote: 'Bits [5:2] BURST_LEN (RW, Reset 0x1)' },
        },
        {
          name: 'RX_DMA_EN',
          msb: 1,
          lsb: 1,
          access: 'RW',
          resetValue: '0x0',
          description: 'Receive DMA channel enable.',
          enumValues: [],
          evidence: { page: 5, quote: 'Bit [1] RX_DMA_EN' },
        },
        {
          name: 'TX_DMA_EN',
          msb: 0,
          lsb: 0,
          access: 'RW',
          resetValue: '0x0',
          description: 'Transmit DMA channel enable.',
          enumValues: [],
          evidence: { page: 5, quote: 'Bit [0] TX_DMA_EN' },
        },
      ],
    },
  ],
};

// =============================================================================
// SPEC PRESET 2: APB_DUAL_TIMER_PWM (v2.1) — Automotive Safety Timer & Dead-Time PWM IP
// =============================================================================

export const TIMER_PWM_PAGES_TEXT: string[] = [
  `APB_DUAL_TIMER_PWM — 32-Bit Dual-Channel Watchdog & Dead-Time PWM Timer IP
Document Revision: v2.1 | Bus Interface: 32-bit AMBA APB4 | Base Address: 0x4002_0000

1. Block Overview
The APB_DUAL_TIMER_PWM IP provides two 32-bit down-counting / up-down center-aligned timers,
complementary PWM outputs with programmable shoot-through dead-time insertion, and a windowed
safety watchdog timer protected by a hardware lock key.

Normative Requirements:
[REQ-TMR-001] (Section 1.1) Writes to WDT_CFG shall be ignored unless WDT_LOCK.UNLOCKED is 1 (unlocked via writing 0xC5A51688 to WDT_LOCK).
[REQ-TMR-002] (Section 1.2) Complementary PWM outputs PWM_H and PWM_L shall never be simultaneously asserted high when DEADTIME_EN is 1.`,

  `2. Register Map Specification (Base: 0x4002_0000)

2.1 TMR_GLB_CTRL — Global Timer & Prescaler Control Register
Address Offset: 0x00 | Width: 32 bits | Reset Value: 0x00010000
Description: Controls clock prescaling, counting mode, and enable bits for Timer 0 and Timer 1.
- Bits [31:24] RESERVED (Access: RESERVED, Reset: 0x0): Reserved bits.
- Bits [23:16] CLK_PRESCALE (Access: RW, Reset: 0x01): 8-bit clock division factor (F_timer = PCLK / (CLK_PRESCALE + 1)).
- Bits [15:4]  RESERVED_2 (Access: RESERVED, Reset: 0x0): Reserved bits.
- Bit  [3]     CENTER_ALIGN_EN (Access: RW, Reset: 0x0): Up-down center-aligned PWM mode enable.
- Bit  [2]     ONE_SHOT_MODE (Access: RW, Reset: 0x0): Stop timer automatically upon reaching zero.
- Bit  [1]     TMR1_EN (Access: RW, Reset: 0x0): Enable Timer Channel 1 counter.
- Bit  [0]     TMR0_EN (Access: RW, Reset: 0x0): Enable Timer Channel 0 counter.

2.2 TMR0_LOAD — Timer 0 Auto-Reload Value Register
Address Offset: 0x04 | Width: 32 bits | Reset Value: 0xFFFFFFFF
Description: 32-bit reload period value loaded into Timer 0 on start or terminal count underflow.
- Bits [31:0] RELOAD_VAL (Access: RW, Reset: 0xFFFFFFFF): 32-bit period count in prescaled clock ticks.`,

  `2.3 TMR0_COUNT — Timer 0 Current Counter Value Register
Address Offset: 0x08 | Width: 32 bits | Reset Value: 0xFFFFFFFF
Description: Live readback of the 32-bit Timer 0 down-counter.
- Bits [31:0] CURR_COUNT (Access: RO, Reset: 0xFFFFFFFF): Current instantaneous value of Timer 0.

2.4 PWM_DEADTIME_CFG — Complementary PWM Duty & Dead-Time Register
Address Offset: 0x0C | Width: 32 bits | Reset Value: 0x00100000
Description: Configures high-side/low-side dead-time cycles, fault polarity, and PWM duty cycle.
- Bits [31:25] RESERVED (Access: RESERVED, Reset: 0x0): Reserved bits.
- Bit  [24]    DEADTIME_EN (Access: RW, Reset: 0x0): Enable complementary dead-time generator.
- Bits [23:16] DEADTIME_CYC (Access: RW, Reset: 0x10): Dead-time insertion delay in PCLK cycles (resets to 16 cycles = 0x10).
- Bits [15:0]  PWM_DUTY_CMP (Access: RW, Reset: 0x0000): 16-bit PWM compare threshold.`,

  `2.5 TMR_INT_STAT — Timer & Watchdog Interrupt Status Register
Address Offset: 0x10 | Width: 32 bits | Reset Value: 0x00000000
Description: Sticky interrupt flags for terminal count, PWM fault emergency brake, and watchdog pre-timeout.
- Bits [31:4] RESERVED (Access: RESERVED, Reset: 0x0): Reserved bits.
- Bit  [3]    PWM_FAULT_IRQ (Access: W1C, Reset: 0x0): External over-current fault pin triggered. Write 1 to clear.
- Bit  [2]    WDT_BARK_IRQ (Access: W1C, Reset: 0x0): Watchdog early warning bark interrupt flag. Write 1 to clear.
- Bit  [1]    TMR1_OVF_IRQ (Access: W1C, Reset: 0x0): Timer 1 terminal count underflow interrupt. Write 1 to clear.
- Bit  [0]    TMR0_OVF_IRQ (Access: W1C, Reset: 0x0): Timer 0 terminal count underflow interrupt. Write 1 to clear.

2.6 WDT_LOCK — Watchdog Hardware Key & Lock Status Register
Address Offset: 0x14 | Width: 32 bits | Reset Value: 0x00000000
Description: Write 0xC5A51688 to unlock watchdog configuration; reading bit 0 returns unlock status.
- Bits [31:1] KEY_WRITE (Access: WO, Reset: 0x0): Write magic key 0xC5A51688 across [31:0] to unlock.
- Bit  [0]    UNLOCKED (Access: RO, Reset: 0x0): 1 when watchdog registers are unlocked for modification.

3. AC Timing & Safety Requirements
- f_TMR_PCLK: Timer Bus & Counter Clock | Min: 1 | Typ: 200 | Max: 500 | Unit: MHz | Condition: Automotive Grade 1
- t_FAULT_SHUTOFF: FAULT_N Pin to PWM High-Z Shutoff | Min: 1 | Typ: 1.5 | Max: 2 | Unit: ns | Condition: Asynchronous combinational path
[REQ-TMR-003] (Section 3.2) Assertion of the external FAULT_N input pin shall tri-state PWM_H and PWM_L within 2 ns without waiting for PCLK.`,
];

export const TIMER_PWM_DOC_MAP: DocumentMap = {
  ipName: 'APB_DUAL_TIMER_PWM',
  ipVersion: 'v2.1',
  busWidth: 32,
  baseAddress: '0x40020000',
  totalPages: 4,
  sections: [
    {
      id: 'tmr-sec-1',
      title: '1. Block Overview & Safety Lock Requirements',
      startPage: 1,
      endPage: 1,
      hasRegisters: false,
      hasTiming: false,
      hasRequirements: true,
      summary: 'Dual 32-bit timer architecture, complementary dead-time PWM, and watchdog key protection.',
    },
    {
      id: 'tmr-sec-2',
      title: '2.1 - 2.4 Register Map: TMR_GLB_CTRL, TMR0_LOAD, TMR0_COUNT, PWM_DEADTIME_CFG',
      startPage: 2,
      endPage: 3,
      hasRegisters: true,
      hasTiming: false,
      hasRequirements: false,
      summary: 'Global prescaler control, 32-bit reload and counter registers, and dead-time PWM configuration.',
    },
    {
      id: 'tmr-sec-3',
      title: '2.5 - 3. Interrupts, WDT_LOCK & Emergency Fault Shutoff Timing',
      startPage: 4,
      endPage: 4,
      hasRegisters: true,
      hasTiming: true,
      hasRequirements: true,
      summary: 'Interrupt W1C status register, WDT_LOCK register, and asynchronous fault shutoff timing.',
    },
  ],
};

export const TIMER_PWM_SPEC: IPSpec = {
  name: 'APB_DUAL_TIMER_PWM',
  version: 'v2.1',
  busWidth: 32,
  baseAddress: '0x40020000',
  registers: [
    {
      id: 'tmr-reg-1',
      name: 'TMR_GLB_CTRL',
      offset: '0x00',
      width: 32,
      description: 'Controls clock prescaling, counting mode, and enable bits for Timer 0 and Timer 1.',
      resetValue: '0x00010000',
      confidence: 0.99,
      repairStatus: 'original',
      reviewStatus: 'accepted',
      evidence: {
        page: 2,
        quote: '2.1 TMR_GLB_CTRL — Global Timer & Prescaler Control Register | Address Offset: 0x00 | Reset Value: 0x00010000',
      },
      fields: [
        {
          name: 'RESERVED',
          msb: 31,
          lsb: 24,
          access: 'RESERVED',
          resetValue: '0x0',
          description: 'Reserved bits.',
          enumValues: [],
          evidence: { page: 2, quote: 'Bits [31:24] RESERVED' },
        },
        {
          name: 'CLK_PRESCALE',
          msb: 23,
          lsb: 16,
          access: 'RW',
          resetValue: '0x01',
          description: '8-bit clock division factor (F_timer = PCLK / (CLK_PRESCALE + 1)).',
          enumValues: [],
          evidence: { page: 2, quote: 'Bits [23:16] CLK_PRESCALE (Access: RW, Reset: 0x01)' },
        },
        {
          name: 'RESERVED_2',
          msb: 15,
          lsb: 4,
          access: 'RESERVED',
          resetValue: '0x0',
          description: 'Reserved bits.',
          enumValues: [],
          evidence: { page: 2, quote: 'Bits [15:4] RESERVED_2' },
        },
        {
          name: 'CENTER_ALIGN_EN',
          msb: 3,
          lsb: 3,
          access: 'RW',
          resetValue: '0x0',
          description: 'Up-down center-aligned PWM mode enable.',
          enumValues: [],
          evidence: { page: 2, quote: 'Bit [3] CENTER_ALIGN_EN (Access: RW, Reset: 0x0)' },
        },
        {
          name: 'ONE_SHOT_MODE',
          msb: 2,
          lsb: 2,
          access: 'RW',
          resetValue: '0x0',
          description: 'Stop timer automatically upon reaching zero.',
          enumValues: [],
          evidence: { page: 2, quote: 'Bit [2] ONE_SHOT_MODE (Access: RW, Reset: 0x0)' },
        },
        {
          name: 'TMR1_EN',
          msb: 1,
          lsb: 1,
          access: 'RW',
          resetValue: '0x0',
          description: 'Enable Timer Channel 1 counter.',
          enumValues: [],
          evidence: { page: 2, quote: 'Bit [1] TMR1_EN (Access: RW, Reset: 0x0)' },
        },
        {
          name: 'TMR0_EN',
          msb: 0,
          lsb: 0,
          access: 'RW',
          resetValue: '0x0',
          description: 'Enable Timer Channel 0 counter.',
          enumValues: [],
          evidence: { page: 2, quote: 'Bit [0] TMR0_EN (Access: RW, Reset: 0x0)' },
        },
      ],
    },
    {
      id: 'tmr-reg-2',
      name: 'TMR0_LOAD',
      offset: '0x04',
      width: 32,
      description: '32-bit reload period value loaded into Timer 0 on start or terminal count underflow.',
      resetValue: '0xFFFFFFFF',
      confidence: 0.99,
      repairStatus: 'original',
      reviewStatus: 'accepted',
      evidence: {
        page: 2,
        quote: '2.2 TMR0_LOAD — Timer 0 Auto-Reload Value Register | Address Offset: 0x04 | Reset Value: 0xFFFFFFFF',
      },
      fields: [
        {
          name: 'RELOAD_VAL',
          msb: 31,
          lsb: 0,
          access: 'RW',
          resetValue: '0xFFFFFFFF',
          description: '32-bit period count in prescaled clock ticks.',
          enumValues: [],
          evidence: { page: 2, quote: 'Bits [31:0] RELOAD_VAL (Access: RW, Reset: 0xFFFFFFFF)' },
        },
      ],
    },
    {
      id: 'tmr-reg-3',
      name: 'TMR0_COUNT',
      offset: '0x08',
      width: 32,
      description: 'Live readback of the 32-bit Timer 0 down-counter.',
      resetValue: '0xFFFFFFFF',
      confidence: 0.98,
      repairStatus: 'original',
      reviewStatus: 'accepted',
      evidence: {
        page: 3,
        quote: '2.3 TMR0_COUNT — Timer 0 Current Counter Value Register | Address Offset: 0x08 | Reset Value: 0xFFFFFFFF',
      },
      fields: [
        {
          name: 'CURR_COUNT',
          msb: 31,
          lsb: 0,
          access: 'RO',
          resetValue: '0xFFFFFFFF',
          description: 'Current instantaneous value of Timer 0.',
          enumValues: [],
          evidence: { page: 3, quote: 'Bits [31:0] CURR_COUNT (Access: RO, Reset: 0xFFFFFFFF)' },
        },
      ],
    },
    {
      id: 'tmr-reg-4',
      name: 'PWM_DEADTIME_CFG',
      offset: '0x0C',
      width: 32,
      description: 'Configures high-side/low-side dead-time cycles, fault polarity, and PWM duty cycle.',
      resetValue: '0x00100000',
      confidence: 0.97,
      repairStatus: 'auto-fixed',
      reviewStatus: 'accepted',
      evidence: {
        page: 3,
        quote: '2.4 PWM_DEADTIME_CFG — Complementary PWM Duty & Dead-Time Register | Address Offset: 0x0C | Reset Value: 0x00100000',
      },
      repairHistory: [
        {
          attempt: 1,
          timestamp: '2026-10-26T23:32:00.000Z',
          errorsFixed: [
            '[RESET_COMPOSITION_MISMATCH] Register PWM_DEADTIME_CFG reset value 0x00000010 did not match composed field reset values 0x00100000.',
          ],
          remainingErrors: [],
          previousRegister: {
            name: 'PWM_DEADTIME_CFG',
            offset: '0x0C',
            width: 32,
            description: 'Configures high-side/low-side dead-time cycles, fault polarity, and PWM duty cycle.',
            resetValue: '0x00000010',
            confidence: 0.85,
            evidence: { page: 3, quote: '2.4 PWM_DEADTIME_CFG | Offset: 0x0C | Reset Value: 0x00100000' },
            fields: [],
          },
        },
      ],
      fields: [
        {
          name: 'RESERVED',
          msb: 31,
          lsb: 25,
          access: 'RESERVED',
          resetValue: '0x0',
          description: 'Reserved bits.',
          enumValues: [],
          evidence: { page: 3, quote: 'Bits [31:25] RESERVED' },
        },
        {
          name: 'DEADTIME_EN',
          msb: 24,
          lsb: 24,
          access: 'RW',
          resetValue: '0x0',
          description: 'Enable complementary dead-time generator.',
          enumValues: [],
          evidence: { page: 3, quote: 'Bit [24] DEADTIME_EN (Access: RW, Reset: 0x0)' },
        },
        {
          name: 'DEADTIME_CYC',
          msb: 23,
          lsb: 16,
          access: 'RW',
          resetValue: '0x10',
          description: 'Dead-time insertion delay in PCLK cycles (resets to 16 cycles = 0x10).',
          enumValues: [],
          evidence: { page: 3, quote: 'Bits [23:16] DEADTIME_CYC (Access: RW, Reset: 0x10)' },
        },
        {
          name: 'PWM_DUTY_CMP',
          msb: 15,
          lsb: 0,
          access: 'RW',
          resetValue: '0x0000',
          description: '16-bit PWM compare threshold.',
          enumValues: [],
          evidence: { page: 3, quote: 'Bits [15:0] PWM_DUTY_CMP (Access: RW, Reset: 0x0000)' },
        },
      ],
    },
    {
      id: 'tmr-reg-5',
      name: 'TMR_INT_STAT',
      offset: '0x10',
      width: 32,
      description: 'Sticky interrupt flags for terminal count, PWM fault emergency brake, and watchdog pre-timeout.',
      resetValue: '0x00000000',
      confidence: 0.99,
      repairStatus: 'original',
      reviewStatus: 'accepted',
      evidence: {
        page: 4,
        quote: '2.5 TMR_INT_STAT — Timer & Watchdog Interrupt Status Register | Address Offset: 0x10 | Reset Value: 0x00000000',
      },
      fields: [
        {
          name: 'RESERVED',
          msb: 31,
          lsb: 4,
          access: 'RESERVED',
          resetValue: '0x0',
          description: 'Reserved bits.',
          enumValues: [],
          evidence: { page: 4, quote: 'Bits [31:4] RESERVED' },
        },
        {
          name: 'PWM_FAULT_IRQ',
          msb: 3,
          lsb: 3,
          access: 'W1C',
          resetValue: '0x0',
          description: 'External over-current fault pin triggered. Write 1 to clear.',
          enumValues: [],
          evidence: { page: 4, quote: 'Bit [3] PWM_FAULT_IRQ (Access: W1C, Reset: 0x0)' },
        },
        {
          name: 'WDT_BARK_IRQ',
          msb: 2,
          lsb: 2,
          access: 'W1C',
          resetValue: '0x0',
          description: 'Watchdog early warning bark interrupt flag. Write 1 to clear.',
          enumValues: [],
          evidence: { page: 4, quote: 'Bit [2] WDT_BARK_IRQ (Access: W1C, Reset: 0x0)' },
        },
        {
          name: 'TMR1_OVF_IRQ',
          msb: 1,
          lsb: 1,
          access: 'W1C',
          resetValue: '0x0',
          description: 'Timer 1 terminal count underflow interrupt. Write 1 to clear.',
          enumValues: [],
          evidence: { page: 4, quote: 'Bit [1] TMR1_OVF_IRQ (Access: W1C, Reset: 0x0)' },
        },
        {
          name: 'TMR0_OVF_IRQ',
          msb: 0,
          lsb: 0,
          access: 'W1C',
          resetValue: '0x0',
          description: 'Timer 0 terminal count underflow interrupt. Write 1 to clear.',
          enumValues: [],
          evidence: { page: 4, quote: 'Bit [0] TMR0_OVF_IRQ (Access: W1C, Reset: 0x0)' },
        },
      ],
    },
    {
      id: 'tmr-reg-6',
      name: 'WDT_LOCK',
      offset: '0x14',
      width: 32,
      description: 'Write 0xC5A51688 to unlock watchdog configuration; reading bit 0 returns unlock status.',
      resetValue: '0x00000000',
      confidence: 0.96,
      repairStatus: 'original',
      reviewStatus: 'accepted',
      evidence: {
        page: 4,
        quote: '2.6 WDT_LOCK — Watchdog Hardware Key & Lock Status Register | Address Offset: 0x14 | Reset Value: 0x00000000',
      },
      fields: [
        {
          name: 'KEY_WRITE',
          msb: 31,
          lsb: 1,
          access: 'WO',
          resetValue: '0x0',
          description: 'Write magic key 0xC5A51688 across [31:0] to unlock.',
          enumValues: [],
          evidence: { page: 4, quote: 'Bits [31:1] KEY_WRITE (Access: WO, Reset: 0x0)' },
        },
        {
          name: 'UNLOCKED',
          msb: 0,
          lsb: 0,
          access: 'RO',
          resetValue: '0x0',
          description: '1 when watchdog registers are unlocked for modification.',
          enumValues: [],
          evidence: { page: 4, quote: 'Bit [0] UNLOCKED (Access: RO, Reset: 0x0)' },
        },
      ],
    },
  ],
  timingParameters: [
    {
      name: 'f_TMR_PCLK',
      min: '1',
      typ: '200',
      max: '500',
      unit: 'MHz',
      condition: 'Automotive Grade 1 (-40C to +125C)',
      evidence: { page: 4, quote: 'f_TMR_PCLK: Timer Bus & Counter Clock | Min: 1 | Typ: 200 | Max: 500 | Unit: MHz' },
    },
    {
      name: 't_FAULT_SHUTOFF',
      min: '1',
      typ: '1.5',
      max: '2',
      unit: 'ns',
      condition: 'Asynchronous combinational path from FAULT_N to PWM High-Z',
      evidence: { page: 4, quote: 't_FAULT_SHUTOFF: FAULT_N Pin to PWM High-Z Shutoff | Min: 1 | Typ: 1.5 | Max: 2 | Unit: ns' },
    },
  ],
  requirements: [
    {
      id: 'REQ-TMR-001',
      section: '1.1',
      page: 1,
      text: 'Writes to WDT_CFG shall be ignored unless WDT_LOCK.UNLOCKED is 1 (unlocked via writing 0xC5A51688 to WDT_LOCK).',
    },
    {
      id: 'REQ-TMR-002',
      section: '1.2',
      page: 1,
      text: 'Complementary PWM outputs PWM_H and PWM_L shall never be simultaneously asserted high when DEADTIME_EN is 1.',
    },
    {
      id: 'REQ-TMR-003',
      section: '3.2',
      page: 4,
      text: 'Assertion of the external FAULT_N input pin shall tri-state PWM_H and PWM_L within 2 ns without waiting for PCLK.',
    },
  ],
};

export const TIMER_PWM_SPEC_V2: IPSpec = {
  ...TIMER_PWM_SPEC,
  version: 'v2.2',
  registers: [
    TIMER_PWM_SPEC.registers[0],
    TIMER_PWM_SPEC.registers[1],
    TIMER_PWM_SPEC.registers[2],
    {
      ...TIMER_PWM_SPEC.registers[3], // PWM_DEADTIME_CFG: DEADTIME_CYC widened to [25:16] and reset changed to 0x00200000
      resetValue: '0x00200000',
      fields: [
        {
          name: 'RESERVED',
          msb: 31,
          lsb: 27,
          access: 'RESERVED',
          resetValue: '0x0',
          description: 'Reserved bits.',
          enumValues: [],
          evidence: { page: 3, quote: 'Bits [31:27] RESERVED' },
        },
        {
          name: 'DEADTIME_EN',
          msb: 26,
          lsb: 26,
          access: 'RW',
          resetValue: '0x0',
          description: 'Enable complementary dead-time generator.',
          enumValues: [],
          evidence: { page: 3, quote: 'Bit [26] DEADTIME_EN' },
        },
        {
          name: 'DEADTIME_CYC',
          msb: 25,
          lsb: 16,
          access: 'RW',
          resetValue: '0x20',
          description: '10-bit dead-time insertion delay in PCLK cycles (widened in v2.2).',
          enumValues: [],
          evidence: { page: 3, quote: 'Bits [25:16] DEADTIME_CYC' },
        },
        TIMER_PWM_SPEC.registers[3].fields[3],
      ],
    },
    TIMER_PWM_SPEC.registers[4],
    TIMER_PWM_SPEC.registers[5],
  ],
};

export const TIMER_PWM_RTL_CODE = `// ============================================================================
// Module: apb_dual_timer_pwm_csr.sv (RTL with bugs vs Spec v2.1)
// ============================================================================
module apb_dual_timer_pwm_csr (
  input  logic        pclk,
  input  logic        preset_n,
  output logic [31:0] prdata
);
  localparam [7:0] ADDR_TMR_GLB_CTRL     = 8'h00;
  localparam [7:0] ADDR_TMR0_LOAD        = 8'h04;
  localparam [7:0] ADDR_TMR0_COUNT       = 8'h08;
  localparam [7:0] ADDR_PWM_DEADTIME_CFG = 8'h0C;
  localparam [7:0] ADDR_TMR_INT_STAT     = 8'h10;
  localparam [7:0] ADDR_WDT_LOCK         = 8'h14;

  // BUG 1: TMR0_LOAD resets to 0x0000_0000 in RTL instead of 0xFFFF_FFFF!
  localparam [31:0] RST_TMR_GLB_CTRL     = 32'h0001_0000;
  localparam [31:0] RST_TMR0_LOAD        = 32'h0000_0000;
  localparam [31:0] RST_TMR0_COUNT       = 32'hFFFF_FFFF;
  localparam [31:0] RST_PWM_DEADTIME_CFG = 32'h0010_0000;
  localparam [31:0] RST_TMR_INT_STAT     = 32'h0000_0000;
  localparam [31:0] RST_WDT_LOCK         = 32'h0000_0000;

  // @field TMR_GLB_CTRL.CLK_PRESCALE [23:16] access=RW reset=0x01
  // @field TMR_GLB_CTRL.CENTER_ALIGN_EN [3:3] access=RW reset=0x0
  // @field TMR_GLB_CTRL.ONE_SHOT_MODE [2:2] access=RW reset=0x0
  // @field TMR_GLB_CTRL.TMR1_EN [1:1] access=RW reset=0x0
  // @field TMR_GLB_CTRL.TMR0_EN [0:0] access=RW reset=0x0

  // @field TMR0_LOAD.RELOAD_VAL [31:0] access=RW reset=0x00000000
  // @field TMR0_COUNT.CURR_COUNT [31:0] access=RO reset=0xFFFFFFFF

  // BUG 2: DEADTIME_CYC wired as [21:16] (6-bit) instead of [23:16] (8-bit)!
  // @field PWM_DEADTIME_CFG.DEADTIME_EN [24:24] access=RW reset=0x0
  // @field PWM_DEADTIME_CFG.DEADTIME_CYC [21:16] access=RW reset=0x10
  // @field PWM_DEADTIME_CFG.PWM_DUTY_CMP [15:0] access=RW reset=0x0000

  // @field TMR_INT_STAT.PWM_FAULT_IRQ [3:3] access=W1C reset=0x0
  // @field TMR_INT_STAT.WDT_BARK_IRQ [2:2] access=W1C reset=0x0
  // @field TMR_INT_STAT.TMR1_OVF_IRQ [1:1] access=W1C reset=0x0
  // @field TMR_INT_STAT.TMR0_OVF_IRQ [0:0] access=W1C reset=0x0

  // @field WDT_LOCK.KEY_WRITE [31:1] access=WO reset=0x0
  // @field WDT_LOCK.UNLOCKED [0:0] access=RO reset=0x0
endmodule
`;

export const TIMER_PWM_C_HEADER_CODE = `/**
 * @file apb_dual_timer_pwm_regs.h
 */
#ifndef _APB_DUAL_TIMER_PWM_REGS_H_
#define _APB_DUAL_TIMER_PWM_REGS_H_

#define APB_DUAL_TIMER_PWM_TMR_GLB_CTRL_OFFSET (0x00U)
#define APB_DUAL_TIMER_PWM_TMR_GLB_CTRL_RESET  (0x00010000UL)
#define APB_DUAL_TIMER_PWM_TMR_GLB_CTRL_CLK_PRESCALE_SHIFT (16U)
#define APB_DUAL_TIMER_PWM_TMR_GLB_CTRL_CLK_PRESCALE_MASK  (0x00FF0000UL)
#define APB_DUAL_TIMER_PWM_TMR_GLB_CTRL_CENTER_ALIGN_EN_SHIFT (3U)
#define APB_DUAL_TIMER_PWM_TMR_GLB_CTRL_CENTER_ALIGN_EN_MASK  (0x00000008UL)
#define APB_DUAL_TIMER_PWM_TMR_GLB_CTRL_ONE_SHOT_MODE_SHIFT (2U)
#define APB_DUAL_TIMER_PWM_TMR_GLB_CTRL_ONE_SHOT_MODE_MASK  (0x00000004UL)
#define APB_DUAL_TIMER_PWM_TMR_GLB_CTRL_TMR1_EN_SHIFT (1U)
#define APB_DUAL_TIMER_PWM_TMR_GLB_CTRL_TMR1_EN_MASK  (0x00000002UL)
#define APB_DUAL_TIMER_PWM_TMR_GLB_CTRL_TMR0_EN_SHIFT (0U)
#define APB_DUAL_TIMER_PWM_TMR_GLB_CTRL_TMR0_EN_MASK  (0x00000001UL)

#define APB_DUAL_TIMER_PWM_TMR0_LOAD_OFFSET (0x04U)
#define APB_DUAL_TIMER_PWM_TMR0_LOAD_RESET  (0xFFFFFFFFUL)
#define APB_DUAL_TIMER_PWM_TMR0_LOAD_RELOAD_VAL_SHIFT (0U)
#define APB_DUAL_TIMER_PWM_TMR0_LOAD_RELOAD_VAL_MASK  (0xFFFFFFFFUL)

#define APB_DUAL_TIMER_PWM_TMR0_COUNT_OFFSET (0x08U)
#define APB_DUAL_TIMER_PWM_TMR0_COUNT_RESET  (0xFFFFFFFFUL)
#define APB_DUAL_TIMER_PWM_TMR0_COUNT_CURR_COUNT_SHIFT (0U)
#define APB_DUAL_TIMER_PWM_TMR0_COUNT_CURR_COUNT_MASK  (0xFFFFFFFFUL)

#define APB_DUAL_TIMER_PWM_PWM_DEADTIME_CFG_OFFSET (0x0CU)
#define APB_DUAL_TIMER_PWM_PWM_DEADTIME_CFG_RESET  (0x00100000UL)
#define APB_DUAL_TIMER_PWM_PWM_DEADTIME_CFG_DEADTIME_EN_SHIFT (24U)
#define APB_DUAL_TIMER_PWM_PWM_DEADTIME_CFG_DEADTIME_EN_MASK  (0x01000000UL)
#define APB_DUAL_TIMER_PWM_PWM_DEADTIME_CFG_DEADTIME_CYC_SHIFT (16U)
#define APB_DUAL_TIMER_PWM_PWM_DEADTIME_CFG_DEADTIME_CYC_MASK  (0x00FF0000UL)
#define APB_DUAL_TIMER_PWM_PWM_DEADTIME_CFG_PWM_DUTY_CMP_SHIFT (0U)
#define APB_DUAL_TIMER_PWM_PWM_DEADTIME_CFG_PWM_DUTY_CMP_MASK  (0x0000FFFFUL)

#define APB_DUAL_TIMER_PWM_TMR_INT_STAT_OFFSET (0x10U)
#define APB_DUAL_TIMER_PWM_TMR_INT_STAT_RESET  (0x00000000UL)
#define APB_DUAL_TIMER_PWM_TMR_INT_STAT_PWM_FAULT_IRQ_SHIFT (3U)
#define APB_DUAL_TIMER_PWM_TMR_INT_STAT_PWM_FAULT_IRQ_MASK  (0x00000008UL)
#define APB_DUAL_TIMER_PWM_TMR_INT_STAT_WDT_BARK_IRQ_SHIFT (2U)
#define APB_DUAL_TIMER_PWM_TMR_INT_STAT_WDT_BARK_IRQ_MASK  (0x00000004UL)
#define APB_DUAL_TIMER_PWM_TMR_INT_STAT_TMR1_OVF_IRQ_SHIFT (1U)
#define APB_DUAL_TIMER_PWM_TMR_INT_STAT_TMR1_OVF_IRQ_MASK  (0x00000002UL)
#define APB_DUAL_TIMER_PWM_TMR_INT_STAT_TMR0_OVF_IRQ_SHIFT (0U)
#define APB_DUAL_TIMER_PWM_TMR_INT_STAT_TMR0_OVF_IRQ_MASK  (0x00000001UL)

/* BUG in Header: WDT_LOCK_OFFSET is 0x18 instead of 0x14! */
#define APB_DUAL_TIMER_PWM_WDT_LOCK_OFFSET (0x18U)
#define APB_DUAL_TIMER_PWM_WDT_LOCK_RESET  (0x00000000UL)
#define APB_DUAL_TIMER_PWM_WDT_LOCK_KEY_WRITE_SHIFT (1U)
#define APB_DUAL_TIMER_PWM_WDT_LOCK_KEY_WRITE_MASK  (0xFFFFFFFEUL)
#define APB_DUAL_TIMER_PWM_WDT_LOCK_UNLOCKED_SHIFT  (0U)
#define APB_DUAL_TIMER_PWM_WDT_LOCK_UNLOCKED_MASK   (0x00000001UL)

#endif
`;

// =============================================================================
// SPEC PRESET 3: QSPI_XIP_CTRL (v3.0) — Quad-SPI Execute-In-Place Flash Controller IP
// =============================================================================

export const QSPI_XIP_PAGES_TEXT: string[] = [
  `QSPI_XIP_CTRL — High-Throughput Quad-SPI Execute-In-Place (XIP) Flash Controller IP
Document Revision: v3.0 | Bus Interface: 32-bit AXI4-Lite CSR + 64-bit AXI4 XIP Port | Base Address: 0x5000_0000

1. Architectural Overview
The QSPI_XIP_CTRL IP interfaces with external Single/Dual/Quad SPI NOR flash memories supporting
Single Data Rate (SDR) and Double Data Rate (DDR) transfers up to 166 MHz, autonomous Execute-In-Place (XIP)
memory-mapped reads, and a 256-byte prefetch buffer.

Normative Requirements:
[REQ-QSPI-001] (Section 1.2) Changing QSPI_CFG.DDR_EN while QSPI_STAT.BUSY is 1 shall be blocked and assert QSPI_STAT.CFG_ERR.
[REQ-QSPI-002] (Section 1.4) In XIP mode, deassertion of CS_N between back-to-back sequential cacheline bursts shall respect QSPI_TIMING.CS_DESELECT_CYC.`,

  `2. Register Map Specification (Base: 0x5000_0000)

2.1 QSPI_CFG — Master QSPI & XIP Mode Configuration Register
Address Offset: 0x00 | Width: 32 bits | Reset Value: 0x00040001
Description: Configures SPI clock phase/polarity, lane width, DDR mode, baud divider, and XIP enable.
- Bits [31:24] RESERVED (Access: RESERVED, Reset: 0x0): Reserved bits.
- Bits [23:16] SCLK_DIV (Access: RW, Reset: 0x04): Serial clock divider (F_sclk = F_ref / (2 * SCLK_DIV)).
- Bits [15:6]  RESERVED_2 (Access: RESERVED, Reset: 0x0): Reserved bits.
- Bits [5:4]   LANE_WIDTH (Access: RW, Reset: 0x0): I/O lane mode (0x0=Single, 0x1=Dual, 0x2=Quad).
- Bit  [3]     DDR_EN (Access: RW, Reset: 0x0): Double Data Rate (DDR) center-aligned sampling enable.
- Bit  [2]     CPOL_CPHA (Access: RW, Reset: 0x0): SPI Mode 0 (0) or SPI Mode 3 (1) select.
- Bit  [1]     XIP_EN (Access: RW, Reset: 0x0): Autonomous memory-mapped Execute-In-Place enable.
- Bit  [0]     CTRL_EN (Access: RW, Reset: 0x1): QSPI controller master enable.

2.2 XIP_CMD_FMT — Execute-In-Place Instruction & Dummy Cycle Register
Address Offset: 0x04 | Width: 32 bits | Reset Value: 0x08EB0000
Description: Defines the flash read opcode, mode bits, and dummy wait cycles for XIP reads.
- Bits [31:29] RESERVED (Access: RESERVED, Reset: 0x0): Reserved bits.
- Bits [28:24] DUMMY_CYCLES (Access: RW, Reset: 0x08): Number of dummy SCLK cycles between address and data (resets to 8).
- Bits [23:16] READ_OPCODE (Access: RW, Reset: 0xEB): 8-bit SPI NOR Quad I/O Fast Read instruction opcode (defaults to 0xEB).
- Bits [15:8]  MODE_BITS (Access: RW, Reset: 0x00): Continuous read mode byte transmitted after address.
- Bits [7:0]   ADDR_BYTES (Access: RW, Reset: 0x00): Address length (0x0=3-byte 24b, 0x1=4-byte 32b).`,

  `2.3 QSPI_TIMING — Chip-Select Setup, Hold & Deselect Timing Register
Address Offset: 0x08 | Width: 32 bits | Reset Value: 0x00040101
Description: Configures CS_N active setup, hold, and minimum deselect high time in SCLK cycles.
- Bits [31:20] RESERVED (Access: RESERVED, Reset: 0x0): Reserved bits.
- Bits [19:16] CS_DESELECT_CYC (Access: RW, Reset: 0x4): Minimum CS_N high time between transactions.
- Bits [15:8]  CS_HOLD_CYC (Access: RW, Reset: 0x01): SCLK to CS_N deassertion hold time.
- Bits [7:0]   CS_SETUP_CYC (Access: RW, Reset: 0x01): CS_N assertion to first SCLK edge setup time.

2.4 QSPI_STAT — Controller & Prefetch Status Register
Address Offset: 0x0C | Width: 32 bits | Reset Value: 0x00000002
Description: Reports controller busy status, prefetch buffer fill state, and configuration error flags.
- Bits [31:4] RESERVED (Access: RESERVED, Reset: 0x0): Reserved bits.
- Bit  [3]    AXI_TIMEOUT_ERR (Access: W1C, Reset: 0x0): Flash slave failed to respond within watchdog window.
- Bit  [2]    CFG_ERR (Access: W1C, Reset: 0x0): Illegal configuration write attempted while BUSY=1.
- Bit  [1]    XIP_READY (Access: RO, Reset: 0x1): XIP prefetch engine ready to service AXI4 bursts.
- Bit  [0]    BUSY (Access: RO, Reset: 0x0): SPI serial engine actively shifting frame.

3. Electrical & SDR/DDR Timing Table
- f_SCLK_SDR: Max SDR Serial Clock | Min: 1 | Typ: 133 | Max: 166 | Unit: MHz | Condition: CL = 15pF
- f_SCLK_DDR: Max DDR Serial Clock | Min: 1 | Typ: 80 | Max: 100 | Unit: MHz | Condition: DQS strobe enabled
- t_CS_HIGH: Minimum CS_N Deselect Pulse | Min: 18 | Typ: 24 | Max: — | Unit: ns | Condition: Quad Fast Read 0xEB`,
];

export const QSPI_XIP_DOC_MAP: DocumentMap = {
  ipName: 'QSPI_XIP_CTRL',
  ipVersion: 'v3.0',
  busWidth: 32,
  baseAddress: '0x50000000',
  totalPages: 3,
  sections: [
    {
      id: 'qspi-sec-1',
      title: '1. Architectural Overview & Normative XIP Mandates',
      startPage: 1,
      endPage: 1,
      hasRegisters: false,
      hasTiming: false,
      hasRequirements: true,
      summary: 'Quad-SPI SDR/DDR architecture, 256-byte prefetch buffer, and XIP safety requirements.',
    },
    {
      id: 'qspi-sec-2',
      title: '2.1 - 2.2 Register Map: QSPI_CFG & XIP_CMD_FMT',
      startPage: 2,
      endPage: 2,
      hasRegisters: true,
      hasTiming: false,
      hasRequirements: false,
      summary: 'Master SPI configuration (0x00) and XIP instruction/dummy cycle format (0x04).',
    },
    {
      id: 'qspi-sec-3',
      title: '2.3 - 3. Register Map: QSPI_TIMING, QSPI_STAT & SDR/DDR Timing',
      startPage: 3,
      endPage: 3,
      hasRegisters: true,
      hasTiming: true,
      hasRequirements: false,
      summary: 'CS_N setup/hold/deselect register (0x08), status register (0x0C), and SDR/DDR clock specifications.',
    },
  ],
};

export const QSPI_XIP_SPEC: IPSpec = {
  name: 'QSPI_XIP_CTRL',
  version: 'v3.0',
  busWidth: 32,
  baseAddress: '0x50000000',
  registers: [
    {
      id: 'qspi-reg-1',
      name: 'QSPI_CFG',
      offset: '0x00',
      width: 32,
      description: 'Configures SPI clock phase/polarity, lane width, DDR mode, baud divider, and XIP enable.',
      resetValue: '0x00040001',
      confidence: 0.99,
      repairStatus: 'original',
      reviewStatus: 'accepted',
      evidence: {
        page: 2,
        quote: '2.1 QSPI_CFG — Master QSPI & XIP Mode Configuration Register | Address Offset: 0x00 | Reset Value: 0x00040001',
      },
      fields: [
        {
          name: 'RESERVED',
          msb: 31,
          lsb: 24,
          access: 'RESERVED',
          resetValue: '0x0',
          description: 'Reserved bits.',
          enumValues: [],
          evidence: { page: 2, quote: 'Bits [31:24] RESERVED' },
        },
        {
          name: 'SCLK_DIV',
          msb: 23,
          lsb: 16,
          access: 'RW',
          resetValue: '0x04',
          description: 'Serial clock divider (F_sclk = F_ref / (2 * SCLK_DIV)).',
          enumValues: [],
          evidence: { page: 2, quote: 'Bits [23:16] SCLK_DIV (Access: RW, Reset: 0x04)' },
        },
        {
          name: 'RESERVED_2',
          msb: 15,
          lsb: 6,
          access: 'RESERVED',
          resetValue: '0x0',
          description: 'Reserved bits.',
          enumValues: [],
          evidence: { page: 2, quote: 'Bits [15:6] RESERVED_2' },
        },
        {
          name: 'LANE_WIDTH',
          msb: 5,
          lsb: 4,
          access: 'RW',
          resetValue: '0x0',
          description: 'I/O lane mode (0x0=Single, 0x1=Dual, 0x2=Quad).',
          enumValues: [
            { name: 'SINGLE_SPI', value: '0x0' },
            { name: 'DUAL_SPI', value: '0x1' },
            { name: 'QUAD_SPI', value: '0x2' },
          ],
          evidence: { page: 2, quote: 'Bits [5:4] LANE_WIDTH (Access: RW, Reset: 0x0)' },
        },
        {
          name: 'DDR_EN',
          msb: 3,
          lsb: 3,
          access: 'RW',
          resetValue: '0x0',
          description: 'Double Data Rate (DDR) center-aligned sampling enable.',
          enumValues: [],
          evidence: { page: 2, quote: 'Bit [3] DDR_EN (Access: RW, Reset: 0x0)' },
        },
        {
          name: 'CPOL_CPHA',
          msb: 2,
          lsb: 2,
          access: 'RW',
          resetValue: '0x0',
          description: 'SPI Mode 0 (0) or SPI Mode 3 (1) select.',
          enumValues: [],
          evidence: { page: 2, quote: 'Bit [2] CPOL_CPHA (Access: RW, Reset: 0x0)' },
        },
        {
          name: 'XIP_EN',
          msb: 1,
          lsb: 1,
          access: 'RW',
          resetValue: '0x0',
          description: 'Autonomous memory-mapped Execute-In-Place enable.',
          enumValues: [],
          evidence: { page: 2, quote: 'Bit [1] XIP_EN (Access: RW, Reset: 0x0)' },
        },
        {
          name: 'CTRL_EN',
          msb: 0,
          lsb: 0,
          access: 'RW',
          resetValue: '0x1',
          description: 'QSPI controller master enable.',
          enumValues: [],
          evidence: { page: 2, quote: 'Bit [0] CTRL_EN (Access: RW, Reset: 0x1)' },
        },
      ],
    },
    {
      id: 'qspi-reg-2',
      name: 'XIP_CMD_FMT',
      offset: '0x04',
      width: 32,
      description: 'Defines the flash read opcode, mode bits, and dummy wait cycles for XIP reads.',
      resetValue: '0x08EB0000',
      confidence: 0.98,
      repairStatus: 'original',
      reviewStatus: 'accepted',
      evidence: {
        page: 2,
        quote: '2.2 XIP_CMD_FMT — Execute-In-Place Instruction & Dummy Cycle Register | Address Offset: 0x04 | Reset Value: 0x08EB0000',
      },
      fields: [
        {
          name: 'RESERVED',
          msb: 31,
          lsb: 29,
          access: 'RESERVED',
          resetValue: '0x0',
          description: 'Reserved bits.',
          enumValues: [],
          evidence: { page: 2, quote: 'Bits [31:29] RESERVED' },
        },
        {
          name: 'DUMMY_CYCLES',
          msb: 28,
          lsb: 24,
          access: 'RW',
          resetValue: '0x08',
          description: 'Number of dummy SCLK cycles between address and data (resets to 8).',
          enumValues: [],
          evidence: { page: 2, quote: 'Bits [28:24] DUMMY_CYCLES (Access: RW, Reset: 0x08)' },
        },
        {
          name: 'READ_OPCODE',
          msb: 23,
          lsb: 16,
          access: 'RW',
          resetValue: '0xEB',
          description: '8-bit SPI NOR Quad I/O Fast Read instruction opcode (defaults to 0xEB).',
          enumValues: [],
          evidence: { page: 2, quote: 'Bits [23:16] READ_OPCODE (Access: RW, Reset: 0xEB)' },
        },
        {
          name: 'MODE_BITS',
          msb: 15,
          lsb: 8,
          access: 'RW',
          resetValue: '0x00',
          description: 'Continuous read mode byte transmitted after address.',
          enumValues: [],
          evidence: { page: 2, quote: 'Bits [15:8] MODE_BITS (Access: RW, Reset: 0x00)' },
        },
        {
          name: 'ADDR_BYTES',
          msb: 7,
          lsb: 0,
          access: 'RW',
          resetValue: '0x00',
          description: 'Address length (0x0=3-byte 24b, 0x1=4-byte 32b).',
          enumValues: [],
          evidence: { page: 2, quote: 'Bits [7:0] ADDR_BYTES (Access: RW, Reset: 0x00)' },
        },
      ],
    },
    {
      id: 'qspi-reg-3',
      name: 'QSPI_TIMING',
      offset: '0x08',
      width: 32,
      description: 'Configures CS_N active setup, hold, and minimum deselect high time in SCLK cycles.',
      resetValue: '0x00040101',
      confidence: 0.97,
      repairStatus: 'original',
      reviewStatus: 'accepted',
      evidence: {
        page: 3,
        quote: '2.3 QSPI_TIMING — Chip-Select Setup, Hold & Deselect Timing Register | Address Offset: 0x08 | Reset Value: 0x00040101',
      },
      fields: [
        {
          name: 'RESERVED',
          msb: 31,
          lsb: 20,
          access: 'RESERVED',
          resetValue: '0x0',
          description: 'Reserved bits.',
          enumValues: [],
          evidence: { page: 3, quote: 'Bits [31:20] RESERVED' },
        },
        {
          name: 'CS_DESELECT_CYC',
          msb: 19,
          lsb: 16,
          access: 'RW',
          resetValue: '0x4',
          description: 'Minimum CS_N high time between transactions.',
          enumValues: [],
          evidence: { page: 3, quote: 'Bits [19:16] CS_DESELECT_CYC (Access: RW, Reset: 0x4)' },
        },
        {
          name: 'CS_HOLD_CYC',
          msb: 15,
          lsb: 8,
          access: 'RW',
          resetValue: '0x01',
          description: 'SCLK to CS_N deassertion hold time.',
          enumValues: [],
          evidence: { page: 3, quote: 'Bits [15:8] CS_HOLD_CYC (Access: RW, Reset: 0x01)' },
        },
        {
          name: 'CS_SETUP_CYC',
          msb: 7,
          lsb: 0,
          access: 'RW',
          resetValue: '0x01',
          description: 'CS_N assertion to first SCLK edge setup time.',
          enumValues: [],
          evidence: { page: 3, quote: 'Bits [7:0] CS_SETUP_CYC (Access: RW, Reset: 0x01)' },
        },
      ],
    },
    {
      id: 'qspi-reg-4',
      name: 'QSPI_STAT',
      offset: '0x0C',
      width: 32,
      description: 'Reports controller busy status, prefetch buffer fill state, and configuration error flags.',
      resetValue: '0x00000002',
      confidence: 0.99,
      repairStatus: 'original',
      reviewStatus: 'accepted',
      evidence: {
        page: 3,
        quote: '2.4 QSPI_STAT — Controller & Prefetch Status Register | Address Offset: 0x0C | Reset Value: 0x00000002',
      },
      fields: [
        {
          name: 'RESERVED',
          msb: 31,
          lsb: 4,
          access: 'RESERVED',
          resetValue: '0x0',
          description: 'Reserved bits.',
          enumValues: [],
          evidence: { page: 3, quote: 'Bits [31:4] RESERVED' },
        },
        {
          name: 'AXI_TIMEOUT_ERR',
          msb: 3,
          lsb: 3,
          access: 'W1C',
          resetValue: '0x0',
          description: 'Flash slave failed to respond within watchdog window.',
          enumValues: [],
          evidence: { page: 3, quote: 'Bit [3] AXI_TIMEOUT_ERR (Access: W1C, Reset: 0x0)' },
        },
        {
          name: 'CFG_ERR',
          msb: 2,
          lsb: 2,
          access: 'W1C',
          resetValue: '0x0',
          description: 'Illegal configuration write attempted while BUSY=1.',
          enumValues: [],
          evidence: { page: 3, quote: 'Bit [2] CFG_ERR (Access: W1C, Reset: 0x0)' },
        },
        {
          name: 'XIP_READY',
          msb: 1,
          lsb: 1,
          access: 'RO',
          resetValue: '0x1',
          description: 'XIP prefetch engine ready to service AXI4 bursts.',
          enumValues: [],
          evidence: { page: 3, quote: 'Bit [1] XIP_READY (Access: RO, Reset: 0x1)' },
        },
        {
          name: 'BUSY',
          msb: 0,
          lsb: 0,
          access: 'RO',
          resetValue: '0x0',
          description: 'SPI serial engine actively shifting frame.',
          enumValues: [],
          evidence: { page: 3, quote: 'Bit [0] BUSY (Access: RO, Reset: 0x0)' },
        },
      ],
    },
  ],
  timingParameters: [
    {
      name: 'f_SCLK_SDR',
      min: '1',
      typ: '133',
      max: '166',
      unit: 'MHz',
      condition: 'SDR mode, CL = 15pF',
      evidence: { page: 3, quote: 'f_SCLK_SDR: Max SDR Serial Clock | Min: 1 | Typ: 133 | Max: 166 | Unit: MHz' },
    },
    {
      name: 'f_SCLK_DDR',
      min: '1',
      typ: '80',
      max: '100',
      unit: 'MHz',
      condition: 'DDR mode, DQS strobe enabled',
      evidence: { page: 3, quote: 'f_SCLK_DDR: Max DDR Serial Clock | Min: 1 | Typ: 80 | Max: 100 | Unit: MHz' },
    },
    {
      name: 't_CS_HIGH',
      min: '18',
      typ: '24',
      max: null,
      unit: 'ns',
      condition: 'Quad Fast Read 0xEB minimum CS_N high time',
      evidence: { page: 3, quote: 't_CS_HIGH: Minimum CS_N Deselect Pulse | Min: 18 | Typ: 24 | Max: — | Unit: ns' },
    },
  ],
  requirements: [
    {
      id: 'REQ-QSPI-001',
      section: '1.2',
      page: 1,
      text: 'Changing QSPI_CFG.DDR_EN while QSPI_STAT.BUSY is 1 shall be blocked and assert QSPI_STAT.CFG_ERR.',
    },
    {
      id: 'REQ-QSPI-002',
      section: '1.4',
      page: 1,
      text: 'In XIP mode, deassertion of CS_N between back-to-back sequential cacheline bursts shall respect QSPI_TIMING.CS_DESELECT_CYC.',
    },
  ],
};

export const QSPI_XIP_SPEC_V2: IPSpec = {
  ...QSPI_XIP_SPEC,
  version: 'v3.1',
  registers: [
    QSPI_XIP_SPEC.registers[0],
    {
      ...QSPI_XIP_SPEC.registers[1], // XIP_CMD_FMT: DUMMY_CYCLES default changed from 8 (0x08) to 10 (0x0A) for 166MHz DDR
      resetValue: '0x0AEB0000',
      fields: [
        QSPI_XIP_SPEC.registers[1].fields[0],
        {
          ...QSPI_XIP_SPEC.registers[1].fields[1],
          resetValue: '0x0A',
        },
        ...QSPI_XIP_SPEC.registers[1].fields.slice(2),
      ],
    },
    QSPI_XIP_SPEC.registers[2],
    QSPI_XIP_SPEC.registers[3],
  ],
};

export const QSPI_XIP_RTL_CODE = `// ============================================================================
// Module: qspi_xip_ctrl_csr.sv (RTL with bugs vs Spec v3.0)
// ============================================================================
module qspi_xip_ctrl_csr (
  input  logic        aclk,
  input  logic        areset_n,
  output logic [31:0] rdata
);
  localparam [7:0] ADDR_QSPI_CFG    = 8'h00;
  localparam [7:0] ADDR_XIP_CMD_FMT = 8'h04;
  localparam [7:0] ADDR_QSPI_TIMING = 8'h08;
  localparam [7:0] ADDR_QSPI_STAT   = 8'h0C;

  localparam [31:0] RST_QSPI_CFG    = 32'h0004_0001;
  // BUG 1: READ_OPCODE resets to 0x03 (Standard Read) in RTL instead of 0xEB (Quad Fast Read)!
  localparam [31:0] RST_XIP_CMD_FMT = 32'h0803_0000;
  localparam [31:0] RST_QSPI_TIMING = 32'h0004_0101;
  localparam [31:0] RST_QSPI_STAT   = 32'h0000_0002;

  // @field QSPI_CFG.SCLK_DIV [23:16] access=RW reset=0x04
  // @field QSPI_CFG.LANE_WIDTH [5:4] access=RW reset=0x0
  // @field QSPI_CFG.DDR_EN [3:3] access=RW reset=0x0
  // @field QSPI_CFG.CPOL_CPHA [2:2] access=RW reset=0x0
  // @field QSPI_CFG.XIP_EN [1:1] access=RW reset=0x0
  // @field QSPI_CFG.CTRL_EN [0:0] access=RW reset=0x1

  // @field XIP_CMD_FMT.DUMMY_CYCLES [28:24] access=RW reset=0x08
  // @field XIP_CMD_FMT.READ_OPCODE [23:16] access=RW reset=0x03
  // @field XIP_CMD_FMT.MODE_BITS [15:8] access=RW reset=0x00
  // @field XIP_CMD_FMT.ADDR_BYTES [7:0] access=RW reset=0x00

  // @field QSPI_TIMING.CS_DESELECT_CYC [19:16] access=RW reset=0x4
  // @field QSPI_TIMING.CS_HOLD_CYC [15:8] access=RW reset=0x01
  // @field QSPI_TIMING.CS_SETUP_CYC [7:0] access=RW reset=0x01

  // @field QSPI_STAT.AXI_TIMEOUT_ERR [3:3] access=W1C reset=0x0
  // @field QSPI_STAT.CFG_ERR [2:2] access=W1C reset=0x0
  // @field QSPI_STAT.XIP_READY [1:1] access=RO reset=0x1
  // @field QSPI_STAT.BUSY [0:0] access=RO reset=0x0
endmodule
`;

export const QSPI_XIP_C_HEADER_CODE = `/**
 * @file qspi_xip_regs.h
 */
#ifndef _QSPI_XIP_REGS_H_
#define _QSPI_XIP_REGS_H_

#define QSPI_XIP_CTRL_QSPI_CFG_OFFSET (0x00U)
#define QSPI_XIP_CTRL_QSPI_CFG_RESET  (0x00040001UL)
#define QSPI_XIP_CTRL_QSPI_CFG_SCLK_DIV_SHIFT (16U)
#define QSPI_XIP_CTRL_QSPI_CFG_SCLK_DIV_MASK  (0x00FF0000UL)
#define QSPI_XIP_CTRL_QSPI_CFG_LANE_WIDTH_SHIFT (4U)
#define QSPI_XIP_CTRL_QSPI_CFG_LANE_WIDTH_MASK  (0x00000030UL)
#define QSPI_XIP_CTRL_QSPI_CFG_DDR_EN_SHIFT (3U)
#define QSPI_XIP_CTRL_QSPI_CFG_DDR_EN_MASK  (0x00000008UL)
#define QSPI_XIP_CTRL_QSPI_CFG_CPOL_CPHA_SHIFT (2U)
#define QSPI_XIP_CTRL_QSPI_CFG_CPOL_CPHA_MASK  (0x00000004UL)
#define QSPI_XIP_CTRL_QSPI_CFG_XIP_EN_SHIFT (1U)
#define QSPI_XIP_CTRL_QSPI_CFG_XIP_EN_MASK  (0x00000002UL)
#define QSPI_XIP_CTRL_QSPI_CFG_CTRL_EN_SHIFT (0U)
#define QSPI_XIP_CTRL_QSPI_CFG_CTRL_EN_MASK  (0x00000001UL)

#define QSPI_XIP_CTRL_XIP_CMD_FMT_OFFSET (0x04U)
#define QSPI_XIP_CTRL_XIP_CMD_FMT_RESET  (0x08EB0000UL)
/* BUG in Header: DUMMY_CYCLES_MASK is 4 bits [27:24] instead of 5 bits [28:24]! */
#define QSPI_XIP_CTRL_XIP_CMD_FMT_DUMMY_CYCLES_SHIFT (24U)
#define QSPI_XIP_CTRL_XIP_CMD_FMT_DUMMY_CYCLES_MASK  (0x0F000000UL)
#define QSPI_XIP_CTRL_XIP_CMD_FMT_READ_OPCODE_SHIFT (16U)
#define QSPI_XIP_CTRL_XIP_CMD_FMT_READ_OPCODE_MASK  (0x00FF0000UL)
#define QSPI_XIP_CTRL_XIP_CMD_FMT_MODE_BITS_SHIFT (8U)
#define QSPI_XIP_CTRL_XIP_CMD_FMT_MODE_BITS_MASK  (0x0000FF00UL)
#define QSPI_XIP_CTRL_XIP_CMD_FMT_ADDR_BYTES_SHIFT (0U)
#define QSPI_XIP_CTRL_XIP_CMD_FMT_ADDR_BYTES_MASK  (0x000000FFUL)

#define QSPI_XIP_CTRL_QSPI_TIMING_OFFSET (0x08U)
#define QSPI_XIP_CTRL_QSPI_TIMING_RESET  (0x00040101UL)
#define QSPI_XIP_CTRL_QSPI_TIMING_CS_DESELECT_CYC_SHIFT (16U)
#define QSPI_XIP_CTRL_QSPI_TIMING_CS_DESELECT_CYC_MASK  (0x000F0000UL)
#define QSPI_XIP_CTRL_QSPI_TIMING_CS_HOLD_CYC_SHIFT (8U)
#define QSPI_XIP_CTRL_QSPI_TIMING_CS_HOLD_CYC_MASK  (0x0000FF00UL)
#define QSPI_XIP_CTRL_QSPI_TIMING_CS_SETUP_CYC_SHIFT (0U)
#define QSPI_XIP_CTRL_QSPI_TIMING_CS_SETUP_CYC_MASK  (0x000000FFUL)

#define QSPI_XIP_CTRL_QSPI_STAT_OFFSET (0x0CU)
#define QSPI_XIP_CTRL_QSPI_STAT_RESET  (0x00000002UL)
#define QSPI_XIP_CTRL_QSPI_STAT_AXI_TIMEOUT_ERR_SHIFT (3U)
#define QSPI_XIP_CTRL_QSPI_STAT_AXI_TIMEOUT_ERR_MASK  (0x00000008UL)
#define QSPI_XIP_CTRL_QSPI_STAT_CFG_ERR_SHIFT (2U)
#define QSPI_XIP_CTRL_QSPI_STAT_CFG_ERR_MASK  (0x00000004UL)
#define QSPI_XIP_CTRL_QSPI_STAT_XIP_READY_SHIFT (1U)
#define QSPI_XIP_CTRL_QSPI_STAT_XIP_READY_MASK  (0x00000002UL)
#define QSPI_XIP_CTRL_QSPI_STAT_BUSY_SHIFT (0U)
#define QSPI_XIP_CTRL_QSPI_STAT_BUSY_MASK  (0x00000001UL)

#endif
`;

export const DEMO_SPEC_PRESETS: Record<DemoPresetId, DemoSpecPreset> = {
  uart_16550: {
    id: 'uart_16550',
    label: 'AXI_UART_16550 (v1.4) — High-Speed UART IP',
    shortLabel: 'AXI_UART_16550',
    fileName: 'AXI_UART_16550_Spec_v1.4.pdf',
    pagesText: DEMO_SPEC_PAGES_TEXT,
    docMap: DEMO_DOCUMENT_MAP,
    spec: DEMO_IP_SPEC,
    specV2: DEMO_IP_SPEC_V2,
    rtlCode: DEMO_RTL_CODE,
    cHeaderCode: DEMO_C_HEADER_CODE,
  },
  apb_timer_pwm: {
    id: 'apb_timer_pwm',
    label: 'APB_DUAL_TIMER_PWM (v2.1) — Watchdog & Dead-Time PWM IP',
    shortLabel: 'APB_DUAL_TIMER_PWM',
    fileName: 'APB_DUAL_TIMER_PWM_Spec_v2.1.pdf',
    pagesText: TIMER_PWM_PAGES_TEXT,
    docMap: TIMER_PWM_DOC_MAP,
    spec: TIMER_PWM_SPEC,
    specV2: TIMER_PWM_SPEC_V2,
    rtlCode: TIMER_PWM_RTL_CODE,
    cHeaderCode: TIMER_PWM_C_HEADER_CODE,
  },
  qspi_xip: {
    id: 'qspi_xip',
    label: 'QSPI_XIP_CTRL (v3.0) — Quad-SPI XIP Flash Controller IP',
    shortLabel: 'QSPI_XIP_CTRL',
    fileName: 'QSPI_XIP_CTRL_Spec_v3.0.pdf',
    pagesText: QSPI_XIP_PAGES_TEXT,
    docMap: QSPI_XIP_DOC_MAP,
    spec: QSPI_XIP_SPEC,
    specV2: QSPI_XIP_SPEC_V2,
    rtlCode: QSPI_XIP_RTL_CODE,
    cHeaderCode: QSPI_XIP_C_HEADER_CODE,
  },
};
