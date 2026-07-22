#!/usr/bin/env node

/**
 * Test notifications API and WFH integration
 * This script logs in and fetches notifications to verify everything works
 */

import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';

const API_BASE = 'http://localhost:8096';
const jar = new CookieJar();
const client = wrapper(axios.create({
  baseURL: API_BASE,
  jar: jar,
}));

async function login() {
  console.log('🔐 Logging in...');
  try {
    const response = await client.post('/login.php', {
      email: 'admin@hrms.com',
      password: 'password123'
    });
    
    if (response.data.success) {
      console.log('✓ Login successful');
      console.log('  User:', response.data.data.user.name);
      console.log('  Role:', response.data.data.user.role);
      return response.data.data.user;
    } else {
      console.error('✗ Login failed:', response.data.message);
      return null;
    }
  } catch (error) {
    console.error('✗ Login error:', error.message);
    return null;
  }
}

async function getNotifications() {
  console.log('\n📬 Fetching notifications...');
  try {
    const response = await client.get('/notifications.php');
    
    if (response.data.success) {
      const { notifications = [], unread_count } = response.data.data;
      console.log(`✓ Got ${notifications.length} notifications (${unread_count} unread)`);
      
      if (notifications.length > 0) {
        console.log('\n📋 First 5 notifications:');
        notifications.slice(0, 5).forEach((n, i) => {
          console.log(`\n  ${i + 1}. ${n.title}`);
          console.log(`     Message: ${n.message.substring(0, 80)}...`);
          console.log(`     Type: ${n.type}`);
          console.log(`     Read: ${n.is_read ? 'Yes' : 'No'}`);
          console.log(`     Time: ${n.created_at}`);
        });
      }
      
      return notifications;
    } else {
      console.error('✗ Failed to fetch notifications:', response.data.message);
      return [];
    }
  } catch (error) {
    console.error('✗ Error fetching notifications:', error.message);
    return [];
  }
}

async function getNotificationsSummary() {
  console.log('\n📊 Fetching notification summary...');
  try {
    const response = await client.get('/notifications.php?summary=1');
    
    if (response.data.success) {
      const { unread_count, events = [] } = response.data.data;
      console.log(`✓ Unread count: ${unread_count}`);
      console.log(`✓ New events: ${events.length}`);
      
      if (events.length > 0) {
        console.log('\n  Recent events:');
        events.forEach((e, i) => {
          console.log(`  ${i + 1}. ${e.title} - ${e.message}`);
        });
      }
      
      return { unread_count, events };
    } else {
      console.error('✗ Failed to fetch summary:', response.data.message);
      return null;
    }
  } catch (error) {
    console.error('✗ Error fetching summary:', error.message);
    return null;
  }
}

async function testWFHIntegration() {
  console.log('\n🏠 Testing WFH Integration...');
  try {
    const response = await client.get('/wfh.php');
    
    if (response.data.success) {
      const wfhData = response.data.data;
      console.log('✓ WFH API working');
      console.log(`  Your WFH requests: ${Array.isArray(wfhData) ? wfhData.length : 0}`);
      
      if (Array.isArray(wfhData) && wfhData.length > 0) {
        console.log('\n  WFH Requests:');
        wfhData.forEach((w, i) => {
          console.log(`  ${i + 1}. ${w.start_date} to ${w.end_date} - ${w.status}`);
        });
      }
    } else {
      console.error('✗ WFH API error:', response.data.message);
    }
  } catch (error) {
    console.error('✗ Error testing WFH:', error.message);
  }
}

async function main() {
  console.log('═════════════════════════════════════════');
  console.log('  HRMS Notifications & WFH Test');
  console.log('═════════════════════════════════════════\n');

  // Step 1: Login
  const user = await login();
  if (!user) {
    console.error('\n✗ Cannot proceed without login');
    process.exit(1);
  }

  // Step 2: Get notifications
  const notifications = await getNotifications();

  // Step 3: Get summary
  await getNotificationsSummary();

  // Step 4: Test WFH
  await testWFHIntegration();

  console.log('\n═════════════════════════════════════════');
  console.log('  ✅ Test Complete');
  console.log('═════════════════════════════════════════\n');
}

main().catch(console.error);
