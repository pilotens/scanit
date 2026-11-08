#!/usr/bin/env python3
"""Research-only benchmark of ScanIt SCG candidate detector against CEBSDB ECG.
Run: python scripts/validate_cebs.py --records b001 b002 b003
No diagnostic claims; retrospective data from different hardware.
"""
import argparse, json, urllib.request
from pathlib import Path
import numpy as np
from scipy.signal import butter, sosfilt, find_peaks, resample_poly

BASE = "https://physionet.org/files/cebsdb/1.0.0/"
FS = 5000
def load_record(name, cache):
    cache.mkdir(parents=True, exist_ok=True)
    path = cache / (name + ".dat")
    if not path.exists():
        urllib.request.urlretrieve(BASE + name + ".dat", path)
    data = np.memmap(path, dtype="<i2", mode="r")
    if data.size % 4: raise ValueError("Unexpected WFDB layout")
    return data.reshape((-1,4))

def detect_scg(scg, fs=60):
    # Mirrors current ScanIt algorithm, including one-pole high/low pass.
    dt=1/fs; ah=(1/(2*np.pi*.8))/((1/(2*np.pi*.8))+dt)
    al=dt/((1/(2*np.pi*20))+dt)
    hp=0.; lp=0.; prev=float(scg[0]); out=np.empty(len(scg))
    for i,x in enumerate(scg):
        hp=ah*(hp+float(x)-prev);prev=float(x);lp+=al*(hp-lp);out[i]=lp
    envelope=np.abs(out)
    threshold=max(.018,float(np.median(envelope))*3)
    events=[]
    min_distance=round(fs*.35)
    for i in range(2,len(envelope)-2):
        if envelope[i]<threshold or envelope[i]<=envelope[i-1] or envelope[i]<envelope[i+1]:continue
        if events and i-events[-1]<min_distance:
            if envelope[i]>envelope[events[-1]]:events[-1]=i
        else:events.append(i)
    return np.array(events,dtype=int)/fs

def detect_ecg(ecg):
    # ECG R-peak reference derived automatically; not expert annotated.
    sos=butter(3,[5,25],btype="bandpass",fs=FS,output="sos")
    filtered=sosfilt(sos,ecg.astype(float))
    envelope=np.abs(filtered)
    peaks,_=find_peaks(envelope,distance=int(.35*FS),prominence=max(np.std(envelope)*1.2,1e-6))
    return peaks/FS

def score(events, reference, lag):
    # Match events one-to-one with 150 ms tolerance after global lag.
    tolerance=.15; i=j=tp=0
    shifted=events+lag
    while i<len(shifted) and j<len(reference):
        if abs(shifted[i]-reference[j])<=tolerance:tp+=1;i+=1;j+=1
        elif shifted[i]<reference[j]:i+=1
        else:j+=1
    precision=tp/len(events) if len(events) else 0
    recall=tp/len(reference) if len(reference) else 0
    return {"matched":tp,"candidates":len(events),"ecg_reference_peaks":len(reference),
            "precision":round(precision,4),"recall":round(recall,4),
            "f1":round(2*precision*recall/(precision+recall),4) if precision+recall else 0,
            "lag_seconds":round(lag,3)}

def run(name,cache):
    raw=load_record(name,cache)
    # First 30 s, matching ScanIt's capture duration; WFDB 16-bit 4-channel interleaved.
    segment=np.asarray(raw[:30*FS])
    if len(segment)<30*FS:raise ValueError("Record too short")
    ecg=segment[:,1].astype(float)
    scg=segment[:,3].astype(float)
    # Convert SCG ADC units to mV using the b001 header gain (different for each record);
    # then scale to unit RMS to test morphology only, not phone acceleration calibration.
    scg60=resample_poly(scg,3,250)
    scg60=(scg60-np.median(scg60))/(np.std(scg60)+1e-9)*.1
    events=detect_scg(scg60)
    refs=detect_ecg(ecg)
    # Global lag optimized on same segment: optimistic upper-bound exploratory score,
    # NOT held-out accuracy. Include lag=0 to reveal calibration sensitivity.
    scores=[score(events,refs,float(lag)) for lag in np.arange(-.4,.401,.02)]
    best=max(scores,key=lambda v:v["f1"])
    # Split the 30-second window: fit lag on first 15 s only, then evaluate on last 15 s.
    train_events=events[events<15]; train_refs=refs[refs<15]
    test_events=events[events>=15]; test_refs=refs[refs>=15]
    train_scores=[score(train_events,train_refs,float(lag)) for lag in np.arange(-.4,.401,.02)]
    selected_lag=max(train_scores,key=lambda v:v["f1"])["lag_seconds"]
    holdout=score(test_events,test_refs,selected_lag)
    return {"record":name,"n_samples":len(segment),"fs_original":FS,"fs_phone_simulated":60,
            "train_selected_lag_seconds":selected_lag,"holdout_last_15_seconds":holdout,
            "zero_lag":score(events,refs,0),"best_lag_in_sample":best,
            "limitations":["Lag selected on first 15 seconds and evaluated on second 15 seconds; same subject and recording","ECG peaks are automatically derived, not expert-reviewed",
              "Different sensor, placement, calibration and hardware from iPhone",
              "Amplitude normalized artificially; phone noise and timing jitter not reproduced",
              "No cardiac diagnosis or verified smartphone heart rate"]}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--records",nargs="+",default=["b001","b002","b003"])
    parser.add_argument("--cache",default=".cache/cebsdb")
    parser.add_argument("--output",default="cebs-validation-results.json")
    args=parser.parse_args()
    results=[]
    for name in args.records:
        if not name.startswith("b") or len(name)!=4 or not name[1:].isdigit():raise ValueError("Only CEBS baseline bNNN records")
        results.append(run(name,Path(args.cache)))
    # Micro-average from raw event counts, rather than averaging rounded F1 scores.
    matched=sum(r["holdout_last_15_seconds"]["matched"] for r in results)
    candidates=sum(r["holdout_last_15_seconds"]["candidates"] for r in results)
    reference=sum(r["holdout_last_15_seconds"]["ecg_reference_peaks"] for r in results)
    precision=matched/candidates if candidates else 0
    recall=matched/reference if reference else 0
    micro_f1=2*precision*recall/(precision+recall) if precision+recall else 0
    per_record=[r["holdout_last_15_seconds"]["f1"] for r in results]
    result={"dataset":"PhysioNet CEBSDB 1.0.0","method":"exploratory within-record temporal holdout; no independent subject-level validation",
            "aggregate_holdout":{"records":len(results),"matched":matched,"candidates":candidates,
              "ecg_reference_peaks":reference,"micro_precision":round(precision,4),
              "micro_recall":round(recall,4),"micro_f1":round(micro_f1,4),
              "median_record_f1":round(float(np.median(per_record)),4),
              "min_record_f1":round(min(per_record),4),"max_record_f1":round(max(per_record),4)},
            "results":results}
    Path(args.output).write_text(json.dumps(result,indent=2),encoding="utf-8")
    print(json.dumps(result,indent=2))
if __name__=="__main__":main()
