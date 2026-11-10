<!-- 04 · General technical reference. This is general industry knowledge, NOT ESE-TECH-specific policy. The bot should present it as general guidance and recommend contacting ESE-TECH engineers for site-specific advice. -->

# Technical Reference › Variable Frequency Drives (VFD)

## What is a VFD?
A Variable Frequency Drive (VFD), also called an AC drive, inverter or variable speed drive, controls the speed and torque of an AC motor by changing the frequency and voltage it supplies. Instead of running a motor at full speed all the time, the drive matches motor speed to what the process actually needs.

## Benefits of a VFD
- Energy savings on variable-torque loads such as pumps and fans
- Soft starting: lower inrush current and less mechanical stress on belts, couplings and pipes
- Precise speed and process control
- Built-in motor protection and diagnostics
- Less wear, which can extend equipment life

## How a VFD saves energy (affinity laws)
For centrifugal pumps and fans, the affinity laws state that flow is proportional to speed, pressure to speed squared, and power to speed cubed. In theory, running a fan or pump at 80% speed needs only about half (0.8³ ≈ 51%) of the full-speed power. Real savings depend on the system, which is why an energy audit measures actual loads first.

## What is the difference between 6-pulse and 12-pulse drives?
A standard drive uses a 6-pulse rectifier at its input. A 12-pulse drive uses two 6-pulse rectifiers fed by a phase-shifting transformer, which cancels the largest harmonic currents (the 5th and 7th). The result is much lower harmonic distortion on the plant's power supply. 12-pulse designs are common on large drives, such as the 2MW, 690V fan drives in ESE-TECH's cement-plant project.

## Low voltage vs medium voltage drives
Low voltage (LV) drives typically run on supplies up to about 690V AC. Medium voltage (MV) drives run large motors on supplies of roughly 2.3kV and above. MV drives are used for very large motors where LV would require impractically high currents.

# Technical Reference › Common VFD Faults

## VFD fault codes in general
Always check the manufacturer's manual for your exact fault code; the guidance below is general. Write down the code, note what the machine was doing when it tripped, and contact a qualified engineer if it repeats.

## Overcurrent fault (drive trips on overcurrent)
Typical causes: acceleration time set too short, a mechanical jam or sudden load, a short circuit in the motor or motor cable, or wrong motor nameplate parameters in the drive.

## Overvoltage fault (DC bus overvoltage)
Typical causes: deceleration time set too short, an overhauling or regenerative load (for example a fan coasting or a load lowering), or high supply voltage. Typical remedies, designed by an engineer, are a longer deceleration ramp or a braking resistor/chopper.

## Undervoltage fault
Typical causes: supply voltage dips or brownouts, a lost input phase, or loose input connections.

## Overtemperature fault (drive overheating)
Typical causes: a failed cooling fan, clogged heatsink or filters, high ambient temperature, or poor panel ventilation.

## Ground fault / earth fault
Typical causes: damaged motor or cable insulation, or moisture in the motor, cable or terminal box.

## Motor overload fault
The motor has drawn more than its rated current for too long, usually from mechanical problems (bearings, jammed load) or an undersized motor.

## Communication fault
The drive lost its network connection to the PLC or HMI: check cables, connectors and network settings.

## Is it safe to reset a drive fault myself?
Resetting repeatedly without finding the cause can damage equipment. Record the fault code, check for obvious causes (blocked fan, jammed load, recent changes), and contact a qualified engineer. ESE-TECH provides troubleshooting and emergency repair; contract clients can call 0949 940 1722.

## Electrical safety when working on drives
- Only qualified, authorized personnel should work on drives and panels.
- Follow lockout/tagout (LOTO) procedures.
- Drive DC bus capacitors stay charged after power is switched off. Wait the time stated on the drive label or manual, then verify zero voltage with a meter before touching anything.
- Wear the correct personal protective equipment (PPE) for the voltage level.

# Technical Reference › Automation and Control Systems

## What is a PLC?
A Programmable Logic Controller (PLC) is an industrial computer that reads sensors and switches, runs a control program (often written in ladder logic), and drives outputs such as motors, valves and drives. PLCs are built for harsh plant environments and run continuously.

## What is an HMI?
A Human-Machine Interface (HMI) is the operator screen or touch panel used to monitor and control a machine or process: start/stop, setpoints, alarms and trends.

## What is SCADA?
SCADA (Supervisory Control and Data Acquisition) is software that connects to many PLCs and devices across a plant or several sites. It provides central monitoring, alarms, historical data and remote control.

## What is system integration?
System integration means designing and connecting PLCs, HMIs, SCADA, drives, instruments and networks into one working control system, then programming, testing, commissioning and maintaining it.

## What is an MCC?
A Motor Control Center (MCC) is an assembly of cabinets holding the starters, drives, breakers and protection for many motors in one place, usually in an electrical room.

## What is commissioning?
Commissioning is the final stage of installation: checking wiring, setting parameters, testing the equipment under real conditions and confirming that the system works as designed before handover.

# Technical Reference › Maintenance

## Preventive maintenance checklist for drives and panels (general guidance)
- Keep heatsinks, filters and cooling fans clean and working
- Check panel ventilation and ambient temperature
- Inspect and re-torque power terminations to the manufacturer's values
- Use thermal (infrared) scans to find hot spots
- Watch the age of DC bus capacitors and cooling fans, which wear out over time
- Keep backups of drive parameters and PLC programs
- Keep the area dry and free of conductive dust
- Review fault and alarm logs for repeating problems
ESE-TECH offers preventive maintenance as part of its on-site field services.

# Technical Reference › Brand Product Families

## Common product families from ESE-TECH's partner brands
These are well-known product families from each brand. Ask the ESE-TECH sales team which models it can supply or support for your application.
- Rockwell Automation (Allen-Bradley): PowerFlex drives, ControlLogix and CompactLogix PLCs, PanelView HMIs, FactoryTalk software.
- Danfoss Drives: VLT and VACON drive families.
- ABB: ACS-series drives (for example ACS580 and ACS880) and other drive and automation products.
