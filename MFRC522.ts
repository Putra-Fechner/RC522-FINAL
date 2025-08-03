/**
  * MFRC522 NTAG213 Minimal Block
  */
//% color="#275C6B" weight=100 icon="↔" block="MFRC522 NTAG"
namespace MFRC522 {
    const BlockAdr: number[] = [4, 5, 6]
    const PICC_READ = 0x30
    const PCD_TRANSCEIVE = 0x0C
    const CommandReg = 0x01
    const FIFODataReg = 0x09
    const FIFOLevelReg = 0x0A
    const BitFramingReg = 0x0D
    const ControlReg = 0x0C
    const ComIrqReg = 0x04
    const DivIrqReg = 0x05
    const MAX_LEN = 16
    const TxControlReg = 0x14
    const PCD_RESETPHASE = 0x0F

    let status = 0
    let returnData: number[] = []
    let returnLen = 0

    function SPI_Write(adr: number, val: number) {
        pins.digitalWritePin(DigitalPin.P16, 0)
        pins.spiWrite((adr << 1) & 0x7E)
        pins.spiWrite(val)
        pins.digitalWritePin(DigitalPin.P16, 1)
    }

    function SPI_Read(adr: number): number {
        pins.digitalWritePin(DigitalPin.P16, 0)
        pins.spiWrite(((adr << 1) & 0x7E) | 0x80)
        let val = pins.spiWrite(0)
        pins.digitalWritePin(DigitalPin.P16, 1)
        return val
    }

    function SetBits(reg: number, mask: number) {
        let tmp = SPI_Read(reg)
        SPI_Write(reg, tmp | mask)
    }

    function ClearBits(reg: number, mask: number) {
        let tmp = SPI_Read(reg)
        SPI_Write(reg, tmp & (~mask))
    }

    function CRC_Calculation(data: number[]): number[] {
        ClearBits(DivIrqReg, 0x04)
        SetBits(FIFOLevelReg, 0x80)
        for (let i = 0; i < data.length; i++) {
            SPI_Write(FIFODataReg, data[i])
        }
        SPI_Write(CommandReg, 0x03)

        let i = 255
        while (true) {
            let n = SPI_Read(DivIrqReg)
            i--
            if (!(i != 0 && (n & 0x04) == 0)) break
        }

        let result: number[] = []
        result.push(SPI_Read(0x22))
        result.push(SPI_Read(0x21))
        return result
    }

    function MFRC522_ToCard(command: number, sendData: number[]): [number, number[], number] {
        returnData = []
        returnLen = 0
        status = 2
        let irqEN = 0x77
        let waitIRQ = 0x30
        let n = 0
        let lastBits = 0

        SPI_Write(0x02, irqEN | 0x80)
        ClearBits(ComIrqReg, 0x80)
        SetBits(FIFOLevelReg, 0x80)
        SPI_Write(CommandReg, 0x00)

        for (let i = 0; i < sendData.length; i++) {
            SPI_Write(FIFODataReg, sendData[i])
        }

        SPI_Write(CommandReg, command)

        if (command == PCD_TRANSCEIVE) {
            SetBits(BitFramingReg, 0x80)
        }

        let i = 2000
        while (true) {
            n = SPI_Read(ComIrqReg)
            i--
            if (~(i != 0 && ~(n & 0x01) && ~(n & waitIRQ))) break
        }

        ClearBits(BitFramingReg, 0x80)

        if (i != 0) {
            let error = SPI_Read(0x06)
            if ((error & 0x1B) == 0x00) {
                status = 0
                if ((n & irqEN & 0x01) != 0) status = 1
                if (command == PCD_TRANSCEIVE) {
                    n = SPI_Read(FIFOLevelReg)
                    lastBits = SPI_Read(ControlReg) & 0x07
                    if (lastBits != 0) returnLen = (n - 1) * 8 + lastBits
                    else returnLen = n * 8

                    if (n == 0) n = 1
                    if (n > MAX_LEN) n = MAX_LEN

                    for (let i = 0; i < n; i++) {
                        returnData.push(SPI_Read(FIFODataReg))
                    }
                }
            }
        }

        return [status, returnData, returnLen]
    }

    function ReadRFID(blockAdr: number): number[] {
        let buff: number[] = [PICC_READ, blockAdr]
        let crc = CRC_Calculation(buff)
        buff.push(crc[0])
        buff.push(crc[1])

        let result = MFRC522_ToCard(PCD_TRANSCEIVE, buff)
        status = result[0]
        returnData = result[1]
        returnLen = result[2]

        if (status != 0 || returnData.length != 16) {
            serial.writeLine("Read error")
            return null
        }

        return returnData
    }

    function WriteRFID(blockAdr: number, writeData: number[]) {
        let buff = [0xA0, blockAdr]
        let crc = CRC_Calculation(buff)
        buff.push(crc[0])
        buff.push(crc[1])

        let result = MFRC522_ToCard(PCD_TRANSCEIVE, buff)
        if (result[0] != 0 || result[1][0] != 0x0A) {
            serial.writeLine("Write request failed")
            return
        }

        let dataBlock = writeData.slice(0, 16)
        crc = CRC_Calculation(dataBlock)
        dataBlock.push(crc[0])
        dataBlock.push(crc[1])

        let final = MFRC522_ToCard(PCD_TRANSCEIVE, dataBlock)
        if (final[0] == 0 && final[1][0] == 0x0A) {
            serial.writeLine("Data written")
        } else {
            serial.writeLine("Write error")
        }
    }

    //% block="Initialize MFRC522"
    export function Init() {
        pins.spiPins(DigitalPin.P15, DigitalPin.P14, DigitalPin.P13)
        pins.spiFormat(8, 0)
        pins.digitalWritePin(DigitalPin.P16, 1)

        SPI_Write(CommandReg, PCD_RESETPHASE)
        SPI_Write(0x2A, 0x8D)
        SPI_Write(0x2B, 0x3E)
        SPI_Write(0x2D, 30)
        SPI_Write(0x2E, 0)
        SPI_Write(0x15, 0x40)
        SPI_Write(0x11, 0x3D)

        let temp = SPI_Read(TxControlReg)
        if ((temp & 0x03) == 0) SetBits(TxControlReg, 0x03)
    }

    //% block="Write data %text"
    export function write(text: string) {
        let data: number[] = []
        for (let i = 0; i < text.length; i++) {
            data.push(text.charCodeAt(i))
        }
        for (let i = text.length; i < 48; i++) {
            data.push(32)
        }

        let b = 0
        for (let BlockNum of BlockAdr) {
            WriteRFID(BlockNum, data.slice(b * 16, (b + 1) * 16))
            b++
        }
    }

    //% block="Read data"
    export function read(): string {
        let output = ''
        let data: number[] = []

        for (let BlockNum of BlockAdr) {
            let block = ReadRFID(BlockNum)
            if (block != null) {
                data = data.concat(block)
            }
        }

        for (let c of data) {
            output += String.fromCharCode(c)
        }

        return output.trim()
    }
}
