const qrcode = require('qrcode-terminal');
const { Client, Buttons, List, MessageMedia } = require('whatsapp-web.js');
const client = new Client();

client.on('qr', qr => {
    qrcode.generate(qr, {small: true});
});

client.on('ready', () => {
    console.log('WhatsApp conectado.✅');
});

client.initialize();

// Função auxiliar para criar delay
const delay = ms => new Promise(res => setTimeout(res, ms));

// --- ESTADOS: Rastreia o progresso de cada usuário ---
const greetedUsers = new Set(); // Recebeu a intro longa
const pendingConclusionUsers = new Set(); // Escolheu um catálogo e precisa decidir 9 ou 0
const completedUsers = new Set(); // Fluxo automático encerrado (atendimento manual)

// --- LINKS DOS CATÁLOGOS ---
const LINKS = {
    TENIS: 'https://photos.app.goo.gl/xA8nvxRgWjWAn6sc6',
    ROUPAS: 'https://photos.app.goo.gl/1at15UGctEPiBsEx5',
    PERFUMARIA: 'https://photos.app.goo.gl/2YZYXgaSbnKKHDgd6'
};

// --- MENSAGENS E MENUS ---
const getMenuPrincipalMessage = () => `
*SERVIÇOS DISPONÍVEIS:*

Por favor, escolha uma das opções abaixo:

1️⃣ - Catálogo de Tênis
2️⃣ - Olhar Roupas
3️⃣ - Ver Perfumaria
`;

const getMenuConclusaoMessage = () => `
O catálogo foi enviado! O que você gostaria de fazer agora?

9️⃣ - Voltar ao Menu Principal
0️⃣ - Falar com um Atendente (Encerrar o automático)
`;

const getAtendimentoEncaminhadoMessage = (name) => `
*✅ Atendimento Encaminhado:* Ótimo ${name}!

Sua solicitação já foi passada para um de nossos atendentes. Por favor, aguarde a resposta manual.
`;


// Variável para evitar o envio repetido da mensagem de conclusão
const reminderSent = new Set();

// Função principal de tratamento de mensagens
client.on('message', async msg => {
    const chat = await msg.getChat();
    const body = msg.body.toLowerCase().trim();
    const userId = msg.from; // Identificador único do usuário
    let name = '';

    // Tenta obter o nome do contato
    try {
        const contact = await msg.getContact();
        name = contact.pushname.split(" ")[0];
    } catch (e) {
        console.error("Erro ao obter contato, usando 'cliente'.", e);
        name = 'cliente';
    }

    // --- 0. FLUXO MANUAL/COMPLETADO (Bot em silêncio) ---
    // Se o usuário já concluiu (escolheu 0) e não está tentando reiniciar o atendimento ('oi'),
    // o bot deve responder apenas uma vez para confirmar o encaminhamento.
    if (completedUsers.has(userId) && !body.match(/^(oi|olá|ola|dia|tarde|noite)$/i)) {
        
        // Se a mensagem de lembrete ainda não foi enviada APÓS a conclusão (para mensagens subsequentes como "ok")
        if (!reminderSent.has(userId)) {
             await delay(1000);
             await chat.sendStateTyping();
             await client.sendMessage(msg.from, `*Atenção:* Seu atendimento já está sendo cuidado manualmente. Por favor, aguarde o retorno do atendente.`);
             reminderSent.add(userId);
        }
        return; // ENCERRA o processamento automático
    }


    // --- 1. FLUXO DE CONCLUSÃO PENDENTE (Decisão: 9 ou 0) ---
    if (pendingConclusionUsers.has(userId)) {
        if (body === '0') {
            // A. Falar com Atendente (Encerrar Automático)
            await delay(2000);
            await chat.sendStateTyping();
            await client.sendMessage(msg.from, getAtendimentoEncaminhadoMessage(name));
            
            // Move para o estado final e limpa o estado intermediário
            completedUsers.add(userId);
            pendingConclusionUsers.delete(userId);
            reminderSent.delete(userId); // Limpa o lembrete para uma possível reinicialização
            return;
        } 
        
        if (body === '9' || body === 'menu') {
            // B. Voltar ao Menu Principal
            await delay(1500);
            await chat.sendStateTyping();
            await client.sendMessage(msg.from, getMenuPrincipalMessage());
            
            // Remove do estado intermediário
            pendingConclusionUsers.delete(userId);
            return;
        } 
        
        // C. Resposta Inválida no estado de Conclusão Pendente
        await delay(1000);
        await chat.sendStateTyping();
        await client.sendMessage(msg.from, 'Por favor, digite *9* para voltar ao Menu Principal ou *0* para chamar um atendente.');
        return; 
    }


    // --- 2. FLUXO DE INÍCIO: Saudação + Menu (Gatilhos: oi, olá, dia, tarde, noite) ---
    if (body.match(/^(oi|olá|ola|dia|tarde|noite)$/i)) {
        
        // Se reiniciar, remove de estados de conclusão para que o funil funcione novamente.
        if (completedUsers.has(userId)) { completedUsers.delete(userId); }
        if (pendingConclusionUsers.has(userId)) { pendingConclusionUsers.delete(userId); }
        if (reminderSent.has(userId)) { reminderSent.delete(userId); }


        if (greetedUsers.has(userId)) {
            // Usuário já saudado: Resposta simplificada
            await delay(1500);
            await chat.sendStateTyping();
            await client.sendMessage(msg.from, `Olá novamente, ${name}! Aqui estão nossas opções:`);
        } else {
            // Primeira vez: Sequência completa de boas-vindas
            await delay(3000);
            await chat.sendStateTyping();
            
            await client.sendMessage(msg.from, `Olá! ${name}, tudo bem? 😎`);

            await delay(3000);
            await chat.sendStateTyping();
            
            await client.sendMessage(msg.from, 'Com nossas coleções, seu look ficará melhor.');

            await delay(3000);
            await chat.sendStateTyping();
            
            await client.sendMessage(msg.from, 
                `Conheça nosso Instagram e acesse os links para ver nosso catálogo!\n\n${'https://www.instagram.com/annashoestb'}`
            );
            
            greetedUsers.add(userId); // Marca o usuário como saudado para o futuro
        }
        
        // Envia o menu em ambos os casos 
        await delay(3000);
        await chat.sendStateTyping();
        await client.sendMessage(msg.from, getMenuPrincipalMessage());

        return; // Termina a execução

    }

    // --- 3. FLUXO DE ESCOLHA DE CATÁLOGO (Gatilhos: 1, 2, 3) ---

    let catalogMessage = '';
    let isCatalogChosen = false;
    
    // Opção 1: Catálogo de Tênis
    if (body === '1') {
        catalogMessage = `*👟 Catálogo de Tênis*\n\nConfira nossa seleção completa de modelos:\n🔗 ${LINKS.TENIS}`;
        isCatalogChosen = true;
    } 
    // Opção 2: Olhar Roupas
    else if (body === '2') {
        catalogMessage = `*👕👖 Olhar Roupas*\n\nExplore nossas coleções de roupas masculinas e femininas:\n🔗 ${LINKS.ROUPAS}`;
        isCatalogChosen = true;
    } 
    // Opção 3: Ver Perfumaria
    else if (body === '3') {
        catalogMessage = `*🧴 Ver Perfumaria*\n\nDescubra nossas fragrâncias de luxo:\n🔗 ${LINKS.PERFUMARIA}`;
        isCatalogChosen = true;
    }

    if (isCatalogChosen) {
        // Envia o catálogo
        await delay(2000);
        await chat.sendStateTyping();
        await client.sendMessage(msg.from, catalogMessage);

        // Envia o menu de conclusão
        await delay(3000);
        await chat.sendStateTyping();
        await client.sendMessage(msg.from, getMenuConclusaoMessage());
        
        // Move para o estado de conclusão pendente
        pendingConclusionUsers.add(userId);
        return;
    }
    
    // Opção de Reexibir o Menu Principal (Gatilho: menu)
    else if (body === 'menu') {
        await delay(1500);
        await chat.sendStateTyping();
        await client.sendMessage(msg.from, getMenuPrincipalMessage());
    } 
    
    // Mensagem de Fallback (Se digitar algo que não é entendido)
    else {
        await delay(1000);
        await client.sendMessage(msg.from, 'Desculpe, não entendi. Digite *MENU* para ver as opções.');
    }
});
