# Research and validation plan for experimental SCG

ScanIt records unverified mechanical motion, **not** a diagnostic ECG, validated pulse, ischemia or cardiac imaging.

## Primary references
- Landreani et al., *Beat-to-beat heart rate detection by smartphone's accelerometers: validation with ECG*, IEEE EMBC (2016), DOI 10.1109/EMBC.2016.7590755. https://pubmed.ncbi.nlm.nih.gov/28268385/
- *Recent Advances in Seismocardiography*, review, https://pmc.ncbi.nlm.nih.gov/articles/PMC8189030/
- Albrecht et al., *Seismocardiography with Smartphones: No Leap from Bench to Bedside (Yet)*, DOI 10.3233/SHTI220715. https://pubmed.ncbi.nlm.nih.gov/35773861/
- CEBSDB, PhysioNet, synchronized ECG, respiration and SCG, DOI 10.13026/C2KW23. https://physionet.org/content/cebsdb/1.0.0/
- SensSmartTech, PhysioNet, synchronized ECG, PPG, PCG and accelerometer, DOI 10.13026/fy9p-n277. https://physionet.org/content/senssmarttech/1.0.0/
- MSCardio smartphone SCG data (2025), DOI 10.1016/j.dib.2025.111889. https://www.sciencedirect.com/science/article/pii/S2352340925006134

## Validation gates (not yet passed)
1. Add automated tests with synthetic stationary noise, periodic mechanical impulses, irregular timestamps, dropped samples, drift and motion artifacts. Ensure no candidate is called a verified heartbeat.
2. Evaluate on held-out PhysioNet records with synchronized ECG. Confirm sensor modality, sampling frequency, units and licenses before importing. Measure event matching, missed events, false detections, absolute timing errors, and subject-level generalization. Do not use training records as validation records.
3. Compare phone measurements against synchronized external ECG/PPG using a shared clock or validated synchronization protocol. A manually entered BPM is contextual metadata, not beat-to-beat synchronization.
4. Repeat with multiple placements, postures, phone models and motion conditions. Define rejection rules prospectively and report failure rate.
5. Do not add diagnostic claims or 'normal/abnormal heart' outputs without independent clinical validation.

## Interpretation safeguards
- SCG candidate counts and median intervals are properties of detected motion peaks; do not convert them to heart rate.
- Event-template correlation is descriptive; sensor contact, placement, phase and noise affect it.
- Smartphone browser motion sampling is not a calibrated medical sensor.
- Phone-only Wi-Fi cannot provide anatomical coronary imaging or diagnose infarction.
