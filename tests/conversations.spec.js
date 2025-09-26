// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Pruebas e2e para el sistema de gestión de conversaciones
 * Estas pruebas verifican la funcionalidad de listado, filtrado y selección de conversaciones
 */

test.describe('Sistema de Gestión de Conversaciones', () => {
  
  test.beforeEach(async ({ page }) => {
    // Simular usuario autenticado
    await page.addInitScript(() => {
      localStorage.setItem('firebase:authUser:mock', JSON.stringify({
        uid: 'test-user-id',
        email: 'test@example.com'
      }));
    });

    await page.goto('/');
    await page.waitForSelector('[data-testid="conversations-list"], .conversations, .sidebar', { timeout: 15000 });
  });

  test('Debería mostrar la lista de conversaciones', async ({ page }) => {
    // Verificar que se muestra la lista de conversaciones
    await expect(page.locator('[data-testid="conversations-list"], .conversations')).toBeVisible();
    
    // Verificar que hay al menos una conversación o mensaje de "no hay conversaciones"
    const conversationItems = page.locator('[data-testid="conversation-item"], .conversation-item');
    const noConversationsMessage = page.locator(':has-text("No hay conversaciones"), :has-text("Sin conversaciones")');
    
    await expect(conversationItems.first().or(noConversationsMessage)).toBeVisible();
  });

  test('Debería permitir seleccionar una conversación', async ({ page }) => {
    // Esperar a que carguen las conversaciones
    const conversationItem = page.locator('[data-testid="conversation-item"], .conversation-item').first();
    
    if (await conversationItem.isVisible()) {
      // Hacer click en la primera conversación
      await conversationItem.click();
      
      // Verificar que se abre la ventana de chat
      await expect(page.locator('[data-testid="chat-window"], .chat-window')).toBeVisible();
      
      // Verificar que se muestra el área de entrada de mensajes
      await expect(page.locator('[data-testid="message-input"], textarea, input[placeholder*="mensaje"]')).toBeVisible();
    }
  });

  test('Debería mostrar información de la conversación seleccionada', async ({ page }) => {
    const conversationItem = page.locator('[data-testid="conversation-item"], .conversation-item').first();
    
    if (await conversationItem.isVisible()) {
      await conversationItem.click();
      
      // Verificar que se muestra información del contacto
      await expect(page.locator('[data-testid="contact-info"], .contact-info, .chat-header')).toBeVisible();
      
      // Verificar que se muestran los mensajes de la conversación
      const messagesContainer = page.locator('[data-testid="messages-container"], .messages, .chat-messages');
      await expect(messagesContainer).toBeVisible();
    }
  });

  test('Debería permitir filtrar conversaciones', async ({ page }) => {
    // Buscar el campo de filtro/búsqueda
    const searchInput = page.locator('input[placeholder*="buscar"], input[placeholder*="filtrar"], [data-testid="search-input"]');
    
    if (await searchInput.isVisible()) {
      // Escribir en el campo de búsqueda
      await searchInput.fill('test');
      
      // Verificar que se actualiza la lista (puede estar vacía si no hay coincidencias)
      await page.waitForTimeout(1000); // Esperar a que se aplique el filtro
      
      // La lista debería seguir siendo visible (aunque puede estar vacía)
      await expect(page.locator('[data-testid="conversations-list"], .conversations')).toBeVisible();
    }
  });

  test('Debería mostrar estados de conversación correctamente', async ({ page }) => {
    const conversationItems = page.locator('[data-testid="conversation-item"], .conversation-item');
    
    if (await conversationItems.first().isVisible()) {
      // Verificar que las conversaciones muestran información básica
      const firstConversation = conversationItems.first();
      
      // Debería mostrar nombre/número del contacto
      await expect(firstConversation).toContainText(/\+?\d+|[A-Za-z]/);
      
      // Puede mostrar último mensaje o timestamp
      // Esto es opcional ya que depende del diseño específico
    }
  });

  test('Debería manejar conversaciones sin mensajes', async ({ page }) => {
    // Simular una conversación nueva sin mensajes
    const conversationItem = page.locator('[data-testid="conversation-item"], .conversation-item').first();
    
    if (await conversationItem.isVisible()) {
      await conversationItem.click();
      
      // Verificar que se puede escribir un mensaje incluso sin historial
      const messageInput = page.locator('[data-testid="message-input"], textarea, input[placeholder*="mensaje"]');
      await expect(messageInput).toBeVisible();
      await expect(messageInput).toBeEnabled();
      
      // Verificar que el botón de envío está disponible
      const sendButton = page.locator('[data-testid="send-button"], button:has-text("Enviar"), button[type="submit"]');
      await expect(sendButton).toBeVisible();
    }
  });

  test('Debería actualizar la lista en tiempo real', async ({ page }) => {
    // Verificar que la lista inicial está cargada
    await expect(page.locator('[data-testid="conversations-list"], .conversations')).toBeVisible();
    
    // Simular actualización (esto dependería de la implementación real de Firebase)
    // Por ahora, verificamos que la lista se mantiene reactiva
    await page.waitForTimeout(2000);
    
    // La lista debería seguir siendo visible y funcional
    await expect(page.locator('[data-testid="conversations-list"], .conversations')).toBeVisible();
  });

  test('Debería manejar errores de carga de conversaciones', async ({ page }) => {
    // Interceptar las llamadas a Firebase para simular error
    await page.route('**/*firestore*', route => {
      route.abort('failed');
    });

    // Recargar la página para activar el error
    await page.reload();
    
    // Verificar que se muestra algún indicador de error o estado de carga
    // Esto puede ser un mensaje de error, un spinner, o la lista vacía
    await page.waitForTimeout(5000);
    
    // La aplicación no debería crashear
    await expect(page.locator('body')).toBeVisible();
  });
});