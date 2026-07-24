import ExpoModulesCore
import HealthKit

public class ScanItHealthKitModule: Module {
  private let healthStore = HKHealthStore()
  private let isoFormatter = ISO8601DateFormatter()

  public func definition() -> ModuleDefinition {
    Name("ScanItHealthKit")

    Function("isAvailable") {
      HKHealthStore.isHealthDataAvailable()
    }

    AsyncFunction("requestAuthorization") { (promise: Promise) in
      guard HKHealthStore.isHealthDataAvailable() else {
        promise.reject(HealthKitUnavailableException())
        return
      }

      let readTypes = self.authorizedReadTypes()
      self.healthStore.requestAuthorization(toShare: Set<HKSampleType>(), read: readTypes) { success, error in
        if let error {
          promise.reject(error)
          return
        }

        promise.resolve([
          "requested": success,
          "readTypes": self.readTypeNames()
        ])
      }
    }.runOnQueue(.main)

    AsyncFunction("getLatestSnapshot") { (lookbackDays: Int, promise: Promise) in
      guard HKHealthStore.isHealthDataAvailable() else {
        promise.reject(HealthKitUnavailableException())
        return
      }

      self.loadLatestSnapshot(lookbackDays: lookbackDays, promise: promise)
    }

    AsyncFunction("getRecentElectrocardiograms") { (limit: Int, promise: Promise) in
      guard HKHealthStore.isHealthDataAvailable() else {
        promise.reject(HealthKitUnavailableException())
        return
      }

      self.loadRecentElectrocardiograms(limit: limit, promise: promise)
    }
  }

  private func authorizedReadTypes() -> Set<HKObjectType> {
    var types = Set<HKObjectType>()

    if let heartRate = HKObjectType.quantityType(forIdentifier: .heartRate) {
      types.insert(heartRate)
    }
    if let hrv = HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN) {
      types.insert(hrv)
    }
    if let oxygen = HKObjectType.quantityType(forIdentifier: .oxygenSaturation) {
      types.insert(oxygen)
    }
    if #available(iOS 16.0, *),
       let wristTemperature = HKObjectType.quantityType(forIdentifier: .appleSleepingWristTemperature) {
      types.insert(wristTemperature)
    }
    if #available(iOS 14.0, *) {
      types.insert(HKObjectType.electrocardiogramType())
    }

    return types
  }

  private func readTypeNames() -> [String] {
    var names = [
      "heart-rate",
      "heart-rate-variability-sdnn",
      "oxygen-saturation"
    ]
    if #available(iOS 16.0, *) {
      names.append("sleeping-wrist-temperature")
    }
    if #available(iOS 14.0, *) {
      names.append("electrocardiogram")
    }
    return names
  }

  private func loadLatestSnapshot(lookbackDays: Int, promise: Promise) {
    let clampedDays = max(1, min(lookbackDays, 365))
    let startDate = Calendar.current.date(byAdding: .day, value: -clampedDays, to: Date()) ?? Date.distantPast
    let predicate = HKQuery.predicateForSamples(withStart: startDate, end: Date(), options: .strictEndDate)
    let group = DispatchGroup()
    let lock = NSLock()
    var result: [String: Any] = ["importedAt": isoFormatter.string(from: Date())]
    var firstError: Error?

    func schedule(
      key: String,
      type: HKQuantityType?,
      unit: HKUnit,
      transform: @escaping (Double) -> Double = { $0 }
    ) {
      guard let type else { return }
      group.enter()
      self.queryLatestQuantity(type: type, unit: unit, predicate: predicate, transform: transform) { queryResult in
        lock.lock()
        switch queryResult {
        case .success(let sample):
          if let sample {
            result[key] = sample
          }
        case .failure(let error):
          if firstError == nil {
            firstError = error
          }
        }
        lock.unlock()
        group.leave()
      }
    }

    schedule(
      key: "heartRate",
      type: HKObjectType.quantityType(forIdentifier: .heartRate),
      unit: HKUnit.count().unitDivided(by: HKUnit.minute())
    )
    schedule(
      key: "heartRateVariabilitySdnn",
      type: HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN),
      unit: HKUnit.secondUnit(with: .milli)
    )
    schedule(
      key: "oxygenSaturation",
      type: HKObjectType.quantityType(forIdentifier: .oxygenSaturation),
      unit: HKUnit.percent(),
      transform: { $0 * 100 }
    )
    if #available(iOS 16.0, *) {
      schedule(
        key: "sleepingWristTemperature",
        type: HKObjectType.quantityType(forIdentifier: .appleSleepingWristTemperature),
        unit: HKUnit.degreeCelsius()
      )
    }

    group.notify(queue: .global(qos: .userInitiated)) {
      if let firstError {
        promise.reject(firstError)
      } else {
        promise.resolve(result)
      }
    }
  }

  private func queryLatestQuantity(
    type: HKQuantityType,
    unit: HKUnit,
    predicate: NSPredicate,
    transform: @escaping (Double) -> Double,
    completion: @escaping (Result<[String: Any]?, Error>) -> Void
  ) {
    let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
    let query = HKSampleQuery(
      sampleType: type,
      predicate: predicate,
      limit: 1,
      sortDescriptors: [sort]
    ) { _, samples, error in
      if let error {
        completion(.failure(error))
        return
      }

      guard let sample = samples?.first as? HKQuantitySample else {
        completion(.success(nil))
        return
      }

      var payload: [String: Any] = [
        "value": transform(sample.quantity.doubleValue(for: unit)),
        "unit": unit.unitString,
        "startDate": self.isoFormatter.string(from: sample.startDate),
        "endDate": self.isoFormatter.string(from: sample.endDate),
        "sourceName": sample.sourceRevision.source.name,
        "sourceBundleIdentifier": sample.sourceRevision.source.bundleIdentifier
      ]
      if let deviceName = sample.device?.name {
        payload["deviceName"] = deviceName
      }
      completion(.success(payload))
    }
    healthStore.execute(query)
  }

  private func loadRecentElectrocardiograms(limit: Int, promise: Promise) {
    guard #available(iOS 14.0, *) else {
      promise.resolve([])
      return
    }

    let clampedLimit = max(1, min(limit, 50))
    let ecgType = HKObjectType.electrocardiogramType()
    let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
    let query = HKSampleQuery(
      sampleType: ecgType,
      predicate: nil,
      limit: clampedLimit,
      sortDescriptors: [sort]
    ) { _, samples, error in
      if let error {
        promise.reject(error)
        return
      }

      let electrocardiograms = (samples as? [HKElectrocardiogram] ?? []).map { ecg in
        self.serializeElectrocardiogram(ecg)
      }
      promise.resolve(electrocardiograms)
    }
    healthStore.execute(query)
  }

  @available(iOS 14.0, *)
  private func serializeElectrocardiogram(_ ecg: HKElectrocardiogram) -> [String: Any] {
    var payload: [String: Any] = [
      "id": ecg.uuid.uuidString,
      "startDate": isoFormatter.string(from: ecg.startDate),
      "endDate": isoFormatter.string(from: ecg.endDate),
      "classification": classificationName(ecg.classification),
      "symptomsStatus": symptomsStatusName(ecg.symptomsStatus),
      "voltageMeasurementCount": ecg.numberOfVoltageMeasurements,
      "sourceName": ecg.sourceRevision.source.name,
      "sourceBundleIdentifier": ecg.sourceRevision.source.bundleIdentifier
    ]

    let bpmUnit = HKUnit.count().unitDivided(by: HKUnit.minute())
    if let averageHeartRate = ecg.averageHeartRate {
      payload["averageHeartRateBpm"] = averageHeartRate.doubleValue(for: bpmUnit)
    }
    if let samplingFrequency = ecg.samplingFrequency {
      payload["samplingFrequencyHz"] = samplingFrequency.doubleValue(for: HKUnit.hertz())
    }
    if let algorithmVersion = ecg.metadata?[HKMetadataKeyAppleECGAlgorithmVersion] as? NSNumber {
      payload["algorithmVersion"] = algorithmVersion.intValue
    }
    if let deviceName = ecg.device?.name {
      payload["deviceName"] = deviceName
    }

    return payload
  }

  @available(iOS 14.0, *)
  private func classificationName(_ classification: HKElectrocardiogram.Classification) -> String {
    switch classification {
    case .sinusRhythm: return "sinus-rhythm"
    case .atrialFibrillation: return "atrial-fibrillation"
    case .inconclusiveHighHeartRate: return "inconclusive-high-heart-rate"
    case .inconclusiveLowHeartRate: return "inconclusive-low-heart-rate"
    case .inconclusivePoorReading: return "inconclusive-poor-reading"
    case .inconclusiveOther: return "inconclusive-other"
    case .unrecognized: return "unrecognized"
    case .notSet: return "not-set"
    @unknown default: return "unrecognized"
    }
  }

  @available(iOS 14.0, *)
  private func symptomsStatusName(_ status: HKElectrocardiogram.SymptomsStatus) -> String {
    switch status {
    case .none: return "none"
    case .present: return "present"
    case .notSet: return "not-set"
    @unknown default: return "not-set"
    }
  }
}

private class HealthKitUnavailableException: Exception {
  override var reason: String {
    "HealthKit är inte tillgängligt på den här enheten."
  }
}
