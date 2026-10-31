import { describe, it, expect } from 'vitest';
import {
  generateSystemRDL,
  generateIPXACT,
  generateUVMRAL,
  generateCHeader,
  generateMarkdownDoc,
  generatePythonStub,
  generateTraceabilityCSV,
  generateAllArtifacts,
} from './index.ts';
import { IPSpec } from '../schema/index.ts';

const sampleSpec: IPSpec = {
  name: 'AXI_UART',
  version: 'v1.4',
  busWidth: 32,
  baseAddress: '0x40001000',
  registers: [
    {
      name: 'CTRL',
      offset: '0x00',
      width: 32,
      description: 'UART Control Register',
      resetValue: '0x00000001',
      confidence: 0.99,
      evidence: { page: 2, quote: 'CTRL (0x00) resets to 0x0000_0001' },
      fields: [
        {
          name: 'BAUD_SEL',
          msb: 5,
          lsb: 4,
          access: 'RW',
          resetValue: '0x0',
          description: 'Baud rate prescaler select',
          enumValues: [
            { name: 'DIV_16', value: '0x0' },
            { name: 'DIV_8', value: '0x1' },
          ],
          evidence: { page: 2, quote: 'BAUD_SEL [5:4] RW' },
        },
        {
          name: 'TX_EN',
          msb: 0,
          lsb: 0,
          access: 'RW',
          resetValue: '0x1',
          description: 'Transmitter enable',
          enumValues: [],
          evidence: { page: 2, quote: 'TX_EN [0] RW default 1' },
        },
      ],
    },
    {
      name: 'STATUS',
      offset: '0x04',
      width: 32,
      description: 'UART Status Register',
      resetValue: '0x00000002',
      confidence: 0.96,
      evidence: { page: 3, quote: 'STATUS (0x04)' },
      fields: [
        {
          name: 'OVERRUN_ERR',
          msb: 1,
          lsb: 1,
          access: 'W1C',
          resetValue: '0x1',
          description: 'RX Overrun Error Flag',
          enumValues: [],
          evidence: { page: 3, quote: 'OVERRUN_ERR [1] W1C' },
        },
      ],
    },
  ],
  timingParameters: [
    {
      name: 'f_UART_CLK',
      min: '10',
      typ: '100',
      max: '250',
      unit: 'MHz',
      condition: 'Nominal VDD=0.85V',
      evidence: { page: 5, quote: 'f_UART_CLK: 10 MHz min, 250 MHz max' },
    },
  ],
  requirements: [
    {
      id: 'REQ-UART-001',
      text: 'The UART transmitter shall assert TX_EMPTY within 1 clock cycle of the shift register completing the stop bit.',
      section: '4.1',
      page: 6,
    },
  ],
};

describe('Deterministic Artifact Generators', () => {
  it('generates valid SystemRDL 2.0 with addrmap, reg, and field blocks', () => {
    const rdl = generateSystemRDL(sampleSpec);
    expect(rdl).toContain('addrmap axi_uart_map');
    expect(rdl).toContain('ctrl @ 0x00;');
    expect(rdl).toContain('baud_sel[5:4] = 0x0;');
    expect(rdl).toContain('onwrite = woclr;');
  });

  it('generates valid IEEE 1685 IP-XACT XML', () => {
    const xml = generateIPXACT(sampleSpec);
    expect(xml).toContain('<ipxact:component');
    expect(xml).toContain('<ipxact:name>CTRL</ipxact:name>');
    expect(xml).toContain('<ipxact:bitOffset>4</ipxact:bitOffset>');
    expect(xml).toContain('<ipxact:bitWidth>2</ipxact:bitWidth>');
  });

  it('generates UVM RAL classes with uvm_reg and uvm_reg_block', () => {
    const sv = generateUVMRAL(sampleSpec);
    expect(sv).toContain('class axi_uart_reg_ctrl extends uvm_reg;');
    expect(sv).toContain('class axi_uart_reg_block extends uvm_reg_block;');
    expect(sv).toContain('this.baud_sel.configure(this, 2, 4, "RW"');
  });

  it('generates C header with offsets, shifts, masks, and enum defines', () => {
    const h = generateCHeader(sampleSpec);
    expect(h).toContain('#define AXI_UART_CTRL_OFFSET (0x00U)');
    expect(h).toContain('#define AXI_UART_CTRL_BAUD_SEL_SHIFT (4U)');
    expect(h).toContain('#define AXI_UART_CTRL_BAUD_SEL_MASK  (0x00000030UL)');
    expect(h).toContain('#define AXI_UART_CTRL_BAUD_SEL_DIV_16 (0x0U)');
  });

  it('generates Python bring-up stub, Markdown doc, and Traceability CSV', () => {
    const py = generatePythonStub(sampleSpec);
    expect(py).toContain('class AXI_UARTDriver:');
    expect(py).toContain('def get_ctrl_baud_sel(self) -> int:');
    expect(py).toContain('def set_ctrl_baud_sel(self, field_val: int) -> None:');

    const md = generateMarkdownDoc(sampleSpec);
    expect(md).toContain('## 3. Timing Parameters');
    expect(md).toContain('f_UART_CLK');

    const csv = generateTraceabilityCSV(sampleSpec);
    expect(csv).toContain('requirement_id,section,page,requirement_text,test_name,status');
    expect(csv).toContain('REQ-UART-001,4.1,6,');

    const all = generateAllArtifacts(sampleSpec);
    expect(all).toHaveLength(8);
  });
});
