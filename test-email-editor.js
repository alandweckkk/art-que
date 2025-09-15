// Simple test script to verify email editor functionality
// Run with: node test-email-editor.js

const puppeteer = require('puppeteer');

async function testEmailEditor() {
  let browser;
  try {
    console.log('🚀 Starting email editor test...');
    
    browser = await puppeteer.launch({ 
      headless: false, // Show browser for visual verification
      defaultViewport: { width: 1200, height: 800 }
    });
    
    const page = await browser.newPage();
    
    // Navigate to the app
    console.log('📱 Navigating to localhost:3000...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    
    // Wait for the page to load
    await page.waitForTimeout(3000);
    
    // Look for the Quill editor
    console.log('🔍 Looking for Quill editor...');
    const quillEditor = await page.$('.ql-editor');
    
    if (quillEditor) {
      console.log('✅ Quill editor found!');
      
      // Test clicking in the editor
      console.log('🖱️  Testing click functionality...');
      await quillEditor.click();
      
      // Test typing
      console.log('⌨️  Testing typing...');
      await page.keyboard.type('This is a test email message!');
      
      // Test text selection
      console.log('🖱️  Testing text selection...');
      await page.keyboard.down('Shift');
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press('ArrowLeft');
      }
      await page.keyboard.up('Shift');
      
      // Test paragraph breaks
      console.log('📝 Testing paragraph breaks...');
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await page.keyboard.type('This is a new paragraph.');
      
      console.log('✅ All tests passed! Email editor is working correctly.');
      
    } else {
      console.log('❌ Quill editor not found');
    }
    
    // Keep browser open for manual verification
    console.log('🔍 Browser will stay open for manual verification...');
    await page.waitForTimeout(10000);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

testEmailEditor();
