import { Transaction } from '@mysten/sui/transactions';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';

const client = new SuiJsonRpcClient({
  url: 'https://fullnode.mainnet.sui.io:443',
});

// 先测试 multiGetObjects 是否能正常工作
console.log('=== Testing multiGetObjects ===');
try {
  const result = await client.core.getObjects({
    objectIds: ['0x0000000000000000000000000000000000000000000000000000000000000006']
  });
  console.log('Result:', JSON.stringify(result, null, 2).slice(0, 500));
} catch (e) {
  console.log('Error:', e.message);
  console.log('Full error:', JSON.stringify(e, null, 2).slice(0, 1000));
}

// 测试 getMoveFunction
console.log('\n=== Testing getMoveFunction ===');
try {
  const result = await client.core.getMoveFunction({
    packageId: '0x996c4d9480708fb8b92aa7acf819fb0497b5ec8e65ba06601cae2fb6db3312c3',
    moduleName: 'router',
    name: 'swap',
  });
  console.log('Result:', JSON.stringify(result, null, 2).slice(0, 500));
} catch (e) {
  console.log('Error:', e.message);
}
