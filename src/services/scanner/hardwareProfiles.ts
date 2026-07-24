import type { ScannerHardwareProfile } from '@/domain/radio';

export const scannerHardwareProfiles: ScannerHardwareProfile[] = [
  {
    id: 'infineon-bgt60tr13c',
    name: 'Infineon BGT60TR13C',
    modality: 'mmwave-fmcw',
    transport: ['usb', 'wifi', 'bluetooth'],
    rawDataAccess: true,
    channels: 3,
    frequencyRange: '58–63.5 GHz',
    role: 'mechanical-heart-sensing',
    maturity: 'selected-poc',
    strengths: [
      '1 Tx och 3 Rx möjliggör range-, fas- och vinkelanalys.',
      'Utvecklingskortet kan vidarebefordra rådata över USB.',
      'Connected Sensor Kit har Wi-Fi och Bluetooth för egen firmware.',
    ],
    limitations: [
      'Begränsad penetration i vattenrik vävnad.',
      'Mäter främst mikrorörelse och ytnära mekanik, inte kranskärl direkt.',
    ],
  },
  {
    id: 'novelda-x7-direct',
    name: 'NOVELDA X7 Radar Direct',
    modality: 'uwb-impulse',
    transport: ['usb'],
    rawDataAccess: true,
    channels: 1,
    frequencyRange: 'UWB, konfigurerbart X7-band',
    role: 'tissue-response',
    maturity: 'secondary-poc',
    strengths: [
      'Rå basbandsdata och Python/C++ API.',
      'Bred bandbredd för lager- och reflektivitetsstudier.',
    ],
    limitations: [
      'Första utvecklingsflödet är PC-baserat.',
      'Kräver egen antenn-, kontakt- och vävnadskalibrering.',
    ],
  },
  {
    id: 'esp32-c5-csi-pair',
    name: 'ESP32-C5/C6 CSI-par',
    modality: 'wifi-csi',
    transport: ['wifi', 'usb'],
    rawDataAccess: true,
    channels: 1,
    frequencyRange: '2.4/5 GHz, 20–40 MHz kanalbandbredd',
    role: 'experimental-channel-sensing',
    maturity: 'research-track',
    strengths: [
      'Billig och reproducerbar kanaldata från OFDM-subbärare.',
      'Bra för jämförelse mot användarens egen baslinje.',
    ],
    limitations: [
      'Låg spatial upplösning och hög känslighet för multipath.',
      'Två noder och kontrollerad geometri rekommenderas.',
    ],
  },
];
