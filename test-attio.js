/**
 * Test script for Attio functionality
 * Tests the full pipeline: route -> control bot -> general bot -> attio adapter
 */

const BASE_URL = 'http://localhost:3000';

async function testAttio() {
  console.log('🧪 Testing Attio Functionality...\n');

  // Test 1: Check if server is running
  console.log('Test 1: Checking server status...');
  try {
    const statusRes = await fetch(`${BASE_URL}/api/auth/status`);
    const statusData = await statusRes.json();
    console.log('✅ Server is running');
    console.log('   Auth status:', statusData);
  } catch (error) {
    console.error('❌ Server is not running:', error.message);
    console.log('   Please run: npm run dev');
    return;
  }

  // Test 2: Test chat endpoint with a simple query
  console.log('\nTest 2: Testing chat endpoint with simple query...');
  try {
    const chatRes = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include', // Include cookies
      body: JSON.stringify({
        message: 'How many companies do we have?',
        conversationHistory: []
      })
    });

    if (!chatRes.ok) {
      const errorData = await chatRes.json();
      console.error('❌ Chat request failed:', errorData);
      if (errorData.error?.includes('No tools connected')) {
        console.log('   ⚠️  No Attio token found. Please connect Attio first.');
      }
      return;
    }

    const chatData = await chatRes.json();
    console.log('✅ Chat request successful');
    console.log('   Response:', chatData.response?.substring(0, 100) + '...');
    console.log('   Iterations:', chatData.iterations);
    if (chatData.analysis) {
      console.log('   Analysis:', chatData.analysis);
    }
  } catch (error) {
    console.error('❌ Chat test failed:', error.message);
  }

  // Test 3: Test with a more complex query
  console.log('\nTest 3: Testing with a read query...');
  try {
    const chatRes = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        message: 'List the first 3 companies',
        conversationHistory: []
      })
    });

    if (chatRes.ok) {
      const chatData = await chatRes.json();
      console.log('✅ Complex query successful');
      console.log('   Response preview:', chatData.response?.substring(0, 150) + '...');
    } else {
      const errorData = await chatRes.json();
      console.log('⚠️  Query returned error:', errorData.error);
    }
  } catch (error) {
    console.error('❌ Complex query test failed:', error.message);
  }

  console.log('\n✅ Testing complete!');
}

// Run tests
testAttio().catch(console.error);

