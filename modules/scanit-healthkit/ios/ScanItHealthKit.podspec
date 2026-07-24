require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ScanItHealthKit'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = 'ScanIt'
  s.homepage       = 'https://github.com/pilotens/scanit'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => 'https://github.com/pilotens/scanit.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'HealthKit'
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
