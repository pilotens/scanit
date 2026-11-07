import { Text } from 'react-native';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/Card';
export default function PulseNativeFallback(){return <Screen title="Optisk puls" subtitle="Webbexperiment"><Card><Text>Öppna ScanIt i Safari för att testa den experimentella kamerabaserade pulsmätningen. Den här versionen använder inte native-kameran.</Text></Card></Screen>;}
