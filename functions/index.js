// functions/index.js

const {onRequest} = require("firebase-functions/v2/https");
const {google} = require("googleapis");
const {setGlobalOptions} = require("firebase-functions/v2");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");
const {getStorage} = require("firebase-admin/storage");
const puppeteer = require("puppeteer"); // Ahora usamos el puppeteer completo que instalaste
const chromium = require("@sparticuz/chromium");

// Inicializa Firebase para que las funciones tengan acceso a los servicios
initializeApp();

// Definimos las opciones globales (región) para todas las funciones V2
setGlobalOptions({region: "europe-west1"});

// IDs de tus Hojas de Cálculo
const SHEETS_IDS = {
  marcas: "1ZkZud59zebZByopvFyvg6iXh1-MdXPhJi7_kC4ZgpTQ",
  proveedores: "1rqnzEDdUrWe6zeC1NU1xMGnkaE_fnF6JRiC05Oo8dWY",
  expedientes: "1mT6odh9pbkdJoC_valykj5y1YIX3xjV86ucvIvovLGI",
};

/**
 * Función HTTP que se puede llamar desde una URL.
 * Lee los datos de las 3 GSheets maestras y los sincroniza con Firestore.
 */
exports.syncGSheetsToFirestore = onRequest(async (req, res) => {
  try {
    // 1. Autenticación automática con Google APIs
    const auth = new google.auth.GoogleAuth({
      keyFile: "service-account-key.json",
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({version: "v4", auth});
    const db = getFirestore();

    console.log("Iniciando sincronización...");

    // 2. Sincronizar Proveedores
    const proveedoresData = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEETS_IDS.proveedores,
      range: "'Hoja 1'!A2:O", // Desde la fila 2 para saltar encabezados
    });
    const proveedoresRows = proveedoresData.data.values || [];
    const proveedoresBatch = db.batch();
    proveedoresRows.forEach((row) => {
      const id = row[0];
      if (!id) return; // Si no hay ID, saltamos la fila
      const docRef = db.collection("proveedores").doc(id);
      proveedoresBatch.set(docRef, {
        id: id,
        nombreComercial: row[1] || "",
        nombreFiscal: row[2] || "",
        cif: row[3] || "",
        descripcion: row[4] || "",
        direccionFiscal: row[5] || "",
        telefono1: row[6] || "",
        telefono2: row[7] || "",
        familia1: row[8] || "",
        familia2: row[9] || "",
        familia3: row[10] || "",
        // Combinamos los emails en un array para facilidad de uso
        emails: [row[11], row[12], row[13]].filter((email) => !!email),
        tipo: row[14] || "",
      });
    });
    await proveedoresBatch.commit();
    console.log(`Sincronizados ${proveedoresRows.length} proveedores.`);

    // 3. Sincronizar Marcas
    const marcasData = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEETS_IDS.marcas,
      range: "Marcas!A2:G", // Leemos hasta la columna G
    });
    const marcasRows = marcasData.data.values || [];
    const marcasBatch = db.batch();
    marcasRows.forEach((row) => {
      const nombre = row[0];
      if (!nombre) return;
      const docRef = db.collection("marcas").doc(nombre);

      // Función para convertir texto con comas a número
      const parseMultiplier = (text) =>
        parseFloat(String(text || "1").replace(",", ".")) || 1;

      marcasBatch.set(docRef, {
        nombre: nombre,
        idHoja: row[1] || "",
        proveedorOriginal: row[2] || "", // Columna C
        // Columnas D, E, F, G añadidas
        multiplicadorPC: parseMultiplier(row[3]), // Columna D
        multiplicadorPV: parseMultiplier(row[4]), // Columna E
        multiplicadorPVP: parseMultiplier(row[5]), // Columna F
        dtoPresupuesto: parseMultiplier(row[6]), // Columna G
      });
    });
    await marcasBatch.commit();
    console.log(`
      Sincronizadas ${marcasRows.length} marcas con datos de precios.`);

    // 4. Sincronizar Expedientes
    const expedientesData = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEETS_IDS.expedientes,
      range: "Aceptados!A2:C",
    });
    const expedientesRows = expedientesData.data.values || [];
    const expedientesBatch = db.batch();
    expedientesRows.forEach((row) => {
      const idExpediente = row[0];
      if (!idExpediente) return;
      // Usamos el ID del expediente como ID del documento
      const docRef = db.collection("expedientes").doc(idExpediente);
      expedientesBatch.set(docRef, {
        expediente: idExpediente,
        direccion: row[1] || "",
        idCarpetaGdrive: row[2] || "",
      });
    });
    await expedientesBatch.commit();
    console.log(`Sincronizados ${expedientesRows.length} expedientes.`);

    // --- 5. SINCRONIZAR PRODUCTOS HABITUALES ---
    console.log("Iniciando sincronización de Productos Habituales...");
    const productosHabitualesData = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEETS_IDS.marcas,
      range: "ProductosHabituales!A2:C",
    });
    const productosHabitualesRows = productosHabitualesData.data.values || [];

    const listaProductosHabituales = productosHabitualesRows.map((row) => ({
      marca: row[0] || "",
      codigo: row[1] || "",
      imagenUrl: row[2] || "",
    })).filter((p) => p.marca && p.codigo);

    // Guardamos toda la lista en un único documento de configuración
    const productosHabitualesRef =
      db.collection("config").doc("productosHabituales");
    await productosHabitualesRef.set({
      lista: listaProductosHabituales,
    });
    console.log(`
      Sincronizados ${listaProductosHabituales.length} productos habituales.`);

    res.status(200).send("Sincronización completada con éxito.");
  } catch (error) {
    console.error("Error en la sincronización:", error);
    res
        .status(500)
        .send("Error interno del servidor durante la sincronización.");
  }
});

const {onCall, HttpsError} = require("firebase-functions/v2/https");

/**
 * Función que recibe un ID de GSheet y devuelve la lista de productos.
 */
exports.getProductosPorMarca = onCall({
  // Usamos las mismas opciones globales que ya definimos (región)
}, async (request) => {
  // Verificamos que el usuario que llama está autenticado
  if (!request.auth) {
    throw new HttpsError(
        "unauthenticated",
        "El usuario debe estar autenticado.",
    );
  }

  const sheetId = request.data.sheetId;
  if (!sheetId) {
    throw new HttpsError(
        "invalid-argument",
        "Falta el ID de la hoja de cálculo (sheetId).",
    );
  }

  console.log(`Petición de productos para la hoja: ${sheetId}`);

  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: "service-account-key.json", // Usamos la misma llave explícita
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({version: "v4", auth});

    const productData = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "A2:H",
    });

    const productRows = productData.data.values || [];

    const productos = productRows.map((row) => {
      // Función para parsear el dato "ud/bulto" de la columna D (índice 3)
      let udsPorBulto = 1;
      if (row[3]) {
        const udsStr = String(row[3]).replace(",", ".");
        const udsNum = parseFloat(udsStr);
        if (!isNaN(udsNum)) {
          udsPorBulto = udsNum;
        }
      }

      return {
        codigo: row[0] || "",
        descripcion: row[1] || "",
        formato: row[2] || "",
        udBulto: udsPorBulto,
        // dato_complementario: row[4] || "", // Descomentar si se necesitan
        precio: parseFloat(String(row[5] || "0").replace(",", ".")) || 0,
        unidadVenta: row[6] || "", // Descomentar si se necesitan
      };
    }).filter((p) => p.codigo); // Filtramos filas que no tengan código

    console.log(`Encontrados ${productos.length} productos.`);
    return {productos: productos};
  } catch (error) {
    console.error(`Error al leer la hoja ${sheetId}:`, error);
    throw new HttpsError(
        "internal",
        "No se pudieron cargar los productos de la tarifa.",
    );
  }
});

/**
 * Función invocable que recibe un array de líneas de pedido, las guarda en
 * Firestore, las añade a una hoja de Google Sheets y encola los emails.
 */
exports.finalizarPedido = onCall({
}, async (request) => {
  // 1. Verificación de autenticación y argumentos
  if (!request.auth) {
    throw new HttpsError("unauthenticated",
        "El usuario debe estar autenticado.");
  }
  const lineas = request.data.lineas;
  if (!lineas || !Array.isArray(lineas) || lineas.length === 0) {
    throw new HttpsError("invalid-argument",
        "No se han proporcionado líneas de pedido válidas.");
  }

  const usuarioEmail = request.auth.token.email;
  const db = getFirestore();
  const auth = new google.auth.GoogleAuth({
    keyFile: "service-account-key.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({version: "v4", auth});
  const batch = db.batch();
  const spreadsheetId = "1w0hHnLTe-p3qfz3tW6ngXMcHa1etm3gSNPudCoGD49w";

  const lineasEnriquecidas = []; // Guardaremos las líneas con su nuevo ID aquí

  // 2. Preparar los datos para Firestore (generando IDs primero)
  lineas.forEach((linea) => {
    const pedidoRef = db.collection("pedidos").doc();
    const datosAGuardar = {
      ...linea,
      usuarioEmail: usuarioEmail,
      fechaCreacion: new Date(),
      estado: "Pedido",
    };
    batch.set(pedidoRef, datosAGuardar);
    // Guardamos la línea con su ID para usarla después
    lineasEnriquecidas.push({...datosAGuardar, id: pedidoRef.id});
  });

  try {
    // 2. Guardar todo en Firestore
    await batch.commit();
    console.log(`Pedido de ${usuarioEmail} guardado con éxito en Firestore.`);

    // 3. Filtramos para obtener solo las líneas de ACE DISTRIBUCIÓN
    const lineasParaGSheets = lineasEnriquecidas.filter(
        (linea) => linea.proveedor === "ACE DISTRIBUCION",
    );

    if (lineasParaGSheets.length > 0) {
      // 4. Preparar las filas para Google Sheets
      // --- LÍNEA CORREGIDA ---
      const rowsToAppend = lineasParaGSheets.map((linea) => {
        const fechaDoc = linea.fechaCreacion.toLocaleDateString("es-ES");
        const fechaEntrega = new Date(linea.fechaEntrega)
            .toLocaleDateString("es-ES");
        const precioPVP = linea.precioPVP || 0;
        // Corregido: Multiplicar por 100 para formato %
        const descuento = (linea.dtoPresupuesto || 0);
        const total = linea.cantidad *
                precioPVP * (1 - (linea.dtoPresupuesto || 0));

        return [
          "", // A: fórmula
          "", // B: fórmula
          linea.expediente,
          linea.usuarioEmail,
          "", // E: nº documento
          fechaDoc,
          fechaEntrega,
          "", // H: vacío
          linea.id,
          linea.referenciaEspecifica || "",
          linea.marca,
          linea.descripcion,
          linea.bultos || "",
          parseFloat(linea.cantidad),
          linea.observaciones,
          "", // P: vacío
          "", // Q: vacío
          parseFloat(precioPVP),
          descuento,
          total,
        ];
      });

      // 5. Escribir en Google Sheets
      await sheets.spreadsheets.values.append({
        spreadsheetId: spreadsheetId,
        range: "Pedidos de cliente!A3",
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        resource: {
          values: rowsToAppend,
        },
      });
      console.log(`${rowsToAppend.length} filas de ACE DISTRIBUCIÓN
        añadidas a Google Sheets.`);
    } else {
      console.log("No hay líneas para ACE DISTRIBUCIÓN");
    }
  } catch (error) {
    console.error("Error al guardar el pedido en Firestore o G-Sheets:", error);
    throw new HttpsError("internal",
        "No se pudo guardar el pedido completamente.");
  }

  // 6. Agrupar y encolar emails
  const pedidosAgrupados = new Map();
  lineas.forEach((linea) => {
    const direccionEntrega = linea.proveedor === "ACE DISTRIBUCIÓN" ?
            linea.direccion :
            (linea.necesitaAlmacen ?
              "Calle Galena 13, 47012 Valladolid" : linea.direccion);

    const groupKey = `${linea.proveedor.trim()}|${direccionEntrega}`;
    if (!pedidosAgrupados.has(groupKey)) {
      pedidosAgrupados.set(groupKey, {
        nombreProveedor: linea.proveedor.trim(),
        direccionEntrega: direccionEntrega,
        lineas: [],
      });
    }
    pedidosAgrupados.get(groupKey).lineas.push(linea);
  });

  for (const [key, grupo] of pedidosAgrupados.entries()) {
    try {
      const proveedorQuery = await db.collection("proveedores")
          .where("tipo", "==", "Material")
          .where("nombreFiscal", "==", grupo.nombreProveedor).limit(1).get();

      if (proveedorQuery.empty) {
        console.warn(`No se encontró el proveedor
          '${grupo.nombreProveedor}' para enviarle el email.`);
        continue;
      }
      const destinatarios = proveedorQuery.docs[0].data().emails;
      if (!destinatarios || destinatarios.length === 0) {
        console.warn(`El proveedor
          '${grupo.nombreProveedor}' no tiene emails configurados.`);
        continue;
      }

      await db.collection("correos").add({
        to: destinatarios,
        replyTo: usuarioEmail,
        bcc: [usuarioEmail],
        message: {
          subject: `Nuevo Pedido - Expediente: ${grupo.lineas[0].expediente}`,
          html: `
              <h1>Nuevo Pedido Recibido</h1>
              <p>Pedido realizado por: <strong>${usuarioEmail}</strong>.</p>
              <p><strong>Expediente:
                </strong> ${grupo.lineas[0].expediente}</p>
              <p><strong>Fecha de entrega requerida:</strong>
                ${new Date(grupo.lineas[0].fechaEntrega)
      .toLocaleDateString("es-ES")}</p>
              <p style="background-color: #ffc;
              padding: 10px; border: 1px solid #e0e0e0;">
                  <strong>DIRECCIÓN DE ENTREGA:</strong><br>
                  <strong>${grupo.direccionEntrega}</strong>      
              <h3>Detalles del pedido:</h3>
              <table border="1" cellpadding="5" cellspacing="0"
                style="border-collapse: collapse; width: 100%;">
                  <thead>
                      <tr style="background-color: #f2f2f2;">
                          <th>Código</th>
                          <th>Descripción</th>
                          <th>Cantidad</th>
                          <th>Observaciones</th>
                      </tr>
                  </thead>
                  <tbody>
                      ${grupo.lineas.map((linea) => `
                          <tr>
                              <td>${linea.codigo}</td>
                              <td>${linea.descripcion}</td>
                              <td>${linea.cantidad} ${linea.unidadVenta}</td>
                              <td style="background-color: ${linea.observaciones ? "yellow" : "transparent"};">
                                ${linea.observaciones || ""}
                              </td>
                          </tr>
                      `).join("")}
                  </tbody>
              </table>
          `,
        },
      });
      console.log(`Email para '${grupo.nombreProveedor}' añadido a la cola.`);
    } catch (emailError) {
      console.error(`Error al procesar el email para el grupo ${key}:`,
          emailError);
    }
  }

  return {success: true, message:
    "Pedido guardado, añadido a G-Sheets y emails encolados."};
});

/**
 * Función que actualiza el estado de una línea de pedido específica.
 */
exports.actualizarEstadoPedido = onCall({
}, async (request) => {
  // 1. Verificación de autenticación y argumentos
  if (!request.auth) {
    throw new HttpsError(
        "unauthenticated", "El usuario debe estar autenticado.");
  }
  const {pedidoId, nuevoEstado} = request.data;
  if (!pedidoId || !nuevoEstado) {
    throw new HttpsError(
        "invalid-argument", "Faltan los parámetros pedidoId o nuevoEstado.");
  }

  const usuarioEmail = request.auth.token.email;
  const db = getFirestore();

  // 2. Lógica de Permisos
  const adminConfig = await db.collection("config").doc("usuariosAdmin").get();
  const adminEmails = adminConfig.exists ? adminConfig.data().emails : [];
  const esAdmin = adminEmails.includes(usuarioEmail);

  const estadosPermitidosAdmin = ["Recibido en Almacén", "Enviado a Obra"];

  /* Un admin no puede marcar como "Recibido en Destino",
  y un usuario normal no puede usar estados de admin*/
  if (!esAdmin && estadosPermitidosAdmin.includes(nuevoEstado)) {
    throw new HttpsError(
        "permission-denied", "No tienes permiso para realizar esta acción.");
  }

  // 3. Actualización en Firestore
  try {
    const pedidoRef = db.collection("pedidos").doc(pedidoId);
    await pedidoRef.update({estado: nuevoEstado});

    console.log(
        `Estado del pedido ${pedidoId} actualizado a 
        "${nuevoEstado}" por ${usuarioEmail}.`);
    return {success: true, message: "Estado actualizado."};
  } catch (error) {
    console.error(
        `Error al actualizar el estado del pedido ${pedidoId}:`, error);
    throw new HttpsError(
        "internal", "No se pudo actualizar el estado del pedido.");
  }
});

/**
 * Registra movimientos de entrada (física o de stock), actualiza el estado
 * del pedido y registra las entradas físicas en Google Sheets.
 */
exports.registrarEntrada = onCall({
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "El usuario debe estar autenticado.");
  }

  // Nuevo paquete de datos desde el modal
  const {recepciones, notasGenerales, fotosGeneralesUrls} = request.data;
  if (!recepciones || !Array.isArray(recepciones) || recepciones.length === 0) {
    throw new HttpsError("invalid-argument", "No se proporcionaron líneas para recibir.");
  }

  const usuarioEmail = request.auth.token.email;
  const db = getFirestore();
  const batch = db.batch();
  const fechaRecepcion = new Date();

  // Tus añadidos, que son correctos:
  const auth = new google.auth.GoogleAuth({
    keyFile: "service-account-key.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({version: "v4", auth});
  const spreadsheetId = "1w0hHnLTe-p3qfz3tW6ngXMcHa1etm3gSNPudCoGD49w";
  const rowsToAppend = [];

  try {
    for (const item of recepciones) {
      const pedidoRef = db.collection("pedidos").doc(item.id);
      const movimientoRef = pedidoRef.collection("movimientos").doc();

      const pedidoSnap = await pedidoRef.get();
      if (!pedidoSnap.exists) {
        console.warn(`Pedido ${item.id} no encontrado, se omite.`);
        continue;
      }
      const pedidoData = pedidoSnap.data();

      // 1. Preparamos el movimiento para Firestore
      batch.set(movimientoRef, {
        tipo: item.tipo,
        fecha: fechaRecepcion,
        cantidadRecibida: item.cantidadRecibida,
        notas: item.nota || "",
        notasGenerales: notasGenerales || "",
        usuario: usuarioEmail,
        fotosGenerales: fotosGeneralesUrls || [],
        fotoAlbaranUrl: item.fotoAlbaranUrl || "",
      });

      // 2. Preparamos la actualización de estado (con cálculo robusto)
      const movimientosSnap = await pedidoRef.collection("movimientos").where("tipo", "==", "entrada").get();

      // Suma robusta convirtiendo todo a número
      const totalRecibidoAnterior = movimientosSnap.docs.reduce((sum, doc) =>
        sum + parseFloat(doc.data().cantidadRecibida || 0), 0);

      const totalRecibidoActual = totalRecibidoAnterior + parseFloat(item.cantidadRecibida || 0);
      const cantidadPedida = parseFloat(pedidoData.cantidad || 0);

      // Redondeamos a 4 decimales para una comparación segura
      const roundedTotal = Math.round(totalRecibidoActual * 10000) / 10000;
      const roundedPedida = Math.round(cantidadPedida * 10000) / 10000;

      const nuevoEstado = roundedTotal >= roundedPedida ? "Recibido Completo" : "Recibido Parcial";
      batch.update(pedidoRef, {estado: nuevoEstado});

      // 3. Preparamos la fila para G-Sheets, AHORA CON FILTRO
      if (item.tipo === "entrada" && pedidoData.proveedor === "ACE DISTRIBUCION") {
        const marcaSnap = await db.collection("marcas").doc(pedidoData.marca).get();
        const proveedorOriginal = marcaSnap.exists ? marcaSnap.data().proveedorOriginal : pedidoData.proveedor;
        const total = item.cantidadRecibida * (pedidoData.precioPVP || 0) * (1 - (pedidoData.dtoPresupuesto || 0));

        rowsToAppend.push([
          "", "", pedidoData.expediente, proveedorOriginal, "",
          fechaRecepcion.toLocaleDateString("es-ES"), "", "", item.id,
          item.fotoAlbaranUrl || "",
          pedidoData.marca, pedidoData.descripcion, "",
          parseFloat(pedidoData.cantidad), parseFloat(item.cantidadRecibida), item.nota || "", "",
          parseFloat(pedidoData.precioPVP || 0), (pedidoData.dtoPresupuesto || 0), total,
        ]);
      }
    }

    // 4. Ejecución de operaciones
    await batch.commit();
    if (rowsToAppend.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "Albaranes de entrada!A3",
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        resource: {values: rowsToAppend},
      });
      console.log(`${rowsToAppend.length} filas añadidas a Albaranes de entrada.`);
    }

    return {success: true, message: "Recepción registrada correctamente."};
  } catch (error) {
    console.error("Error al registrar entrada:", error);
    throw new HttpsError("internal", "No se pudo registrar la entrada de mercancía.");
  }
});

/**
 * Procesa la salida de mercancía:
 * 1. Genera un Nº de Albarán único y correlativo mediante una transacción.
 * 2. Sube la imagen de la firma (Data URL) a Firebase Storage.
 * 3. Crea los movimientos de 'salida' y actualiza el estado del pedido en Firestore.
 * 4. Registra el albarán en Google Sheets y genera PDF/email si el proveedor es 'ACE DISTRIBUCION'.
 */
exports.registrarSalida = onCall({
  timeoutSeconds: 120, // Aumentamos el tiempo de espera a 2 minutos
  memory: "1GiB", // Aumentamos la memoria a 1 GB
}, async (request) => {
  const db = getFirestore();
  const storage = getStorage();

  // 1. --- Autenticación y Validación de Datos ---
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "El usuario debe estar autenticado.");
  }
  const usuarioEmail = request.auth.token.email;

  const {
    salidas,
    receptorNombre,
    receptorDni,
    firmaDataUrl,
    fotosMercanciaUrls,
  } = request.data;

  if (!salidas || !Array.isArray(salidas) || salidas.length === 0) {
    throw new HttpsError("invalid-argument", "No se proporcionaron líneas para enviar.");
  }
  if (!receptorNombre || !firmaDataUrl) {
    throw new HttpsError("invalid-argument", "Faltan datos del receptor o la firma.");
  }

  // 2. --- Generación de Nº de Albarán (Transacción Atómica) ---
  const albaranNumero = await db.runTransaction(async (transaction) => {
    const contadorRef = db.collection("contadores").doc("albaranSalida");
    const anoActual = new Date().getFullYear().toString().slice(-2);
    const contadorDoc = await transaction.get(contadorRef);
    let nuevoNumero;
    const nuevoAno = parseInt(anoActual);
    if (!contadorDoc.exists) {
      nuevoNumero = 1;
      transaction.set(contadorRef, {numero: nuevoNumero, ano: nuevoAno});
    } else {
      const datosContador = contadorDoc.data();
      nuevoNumero = (datosContador.ano !== nuevoAno) ? 1 : datosContador.numero + 1;
      transaction.update(contadorRef, {numero: nuevoNumero, ano: nuevoAno});
    }
    const numeroFormateado = String(nuevoNumero).padStart(4, "0");
    return `ABS${numeroFormateado}-${nuevoAno}`;
  }).catch((error) => {
    console.error("Fallo en la transacción del contador:", error);
    throw new HttpsError("internal", "No se pudo generar el número de albarán.");
  });

  // 3. --- Subida de la Firma a Storage ---
  let firmaUrl = "";
  try {
    const matches = firmaDataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      throw new HttpsError("invalid-argument", "El formato de la firma no es válido.");
    }
    const contentType = matches[1];
    const imageBuffer = Buffer.from(matches[2], "base64");
    const filePath = `firmas-salida/${albaranNumero}.png`;
    const file = storage.bucket().file(filePath);
    await file.save(imageBuffer, {metadata: {contentType, cacheControl: "public, max-age=31536000"}});
    await file.makePublic();
    firmaUrl = file.publicUrl();
  } catch (error) {
    console.error("Error al subir la firma a Firebase Storage:", error);
    throw new HttpsError("internal", "No se pudo procesar y guardar la firma.");
  }

  // 4. --- Lógica de Negocio (Batch de Firestore y Google Sheets) ---
  const batch = db.batch();
  const fechaSalida = new Date();
  const rowsToAppend = [];

  const auth = new google.auth.GoogleAuth({
    keyFile: "service-account-key.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({version: "v4", auth});
  const spreadsheetId = "1w0hHnLTe-p3qfz3tW6ngXMcHa1etm3gSNPudCoGD49w";

  // --- CAMBIO 1: Declaramos una variable para guardar la dirección para el PDF ---
  let direccionParaPdf = "";

  try {
    for (const item of salidas) {
      if (!item || !item.id) {
        console.warn("Se recibió una línea de salida sin ID en el backend. Omitiendo.");
        continue;
      }
      if (parseFloat(item.cantidadAEnviar || 0) <= 0) continue;

      const pedidoRef = db.collection("pedidos").doc(item.id);

      // --- CAMBIO 2: La obtención de datos del pedido VUELVE A ESTAR DENTRO DEL BUCLE ---
      const pedidoSnap = await pedidoRef.get();
      if (!pedidoSnap.exists) {
        console.warn(`Pedido ${item.id} no encontrado, se omite.`);
        continue;
      }
      const pedidoData = pedidoSnap.data();

      // Guardamos la dirección del primer pedido que la tenga para usarla en el PDF
      if (!direccionParaPdf && pedidoData.direccion) {
        direccionParaPdf = pedidoData.direccion;
      }

      const movimientoRef = pedidoRef.collection("movimientos").doc();

      // a. Creamos el nuevo movimiento de salida en el batch
      batch.set(movimientoRef, {
        tipo: "salida", fecha: fechaSalida, cantidadEnviada: parseFloat(item.cantidadAEnviar),
        notas: item.notas || "", usuario: usuarioEmail, albaranNumero: albaranNumero,
        receptor: {nombre: receptorNombre, dni: receptorDni || ""},
        firmaUrl: firmaUrl, fotosMercanciaUrls: fotosMercanciaUrls || [],
      });

      // b. Calculamos y actualizamos el estado del pedido en el batch
      const movimientosSalidaSnap = await pedidoRef.collection("movimientos").where("tipo", "==", "salida").get();
      const totalEnviadoAnterior = movimientosSalidaSnap.docs
          .reduce((sum, doc) => sum + parseFloat(doc.data().cantidadEnviada || 0), 0);
      const totalEnviadoActual = totalEnviadoAnterior + parseFloat(item.cantidadAEnviar);
      const cantidadPedida = parseFloat(pedidoData.cantidad);
      const nuevoEstado = totalEnviadoActual >= cantidadPedida ? "Enviado Completo" : "Enviado Parcial";
      batch.update(pedidoRef, {estado: nuevoEstado});

      // c. Filtro y preparación de la fila para Google Sheets
      if (pedidoData.proveedor === "ACE DISTRIBUCION") {
        const cantidadEntregada = parseFloat(item.cantidadAEnviar || 0);
        const precioUnitario = parseFloat(pedidoData.precioPVP || 0); // Corregido a precioUnitario
        const descuento = parseFloat(pedidoData.dtoPresupuesto || 0);
        const totalLinea = cantidadEntregada * precioUnitario * (1 - descuento);
        rowsToAppend.push([
          "",
          "",
          pedidoData.expediente || "",
          pedidoData.usuarioEmail || "",
          albaranNumero,
          fechaSalida.toLocaleDateString("es-ES"),
          receptorNombre,
          firmaUrl,
          item.id,
          pedidoData.referenciaEspecifica || "",
          pedidoData.marca || "", pedidoData.descripcion || "",
          pedidoData.bultos || "",
          parseFloat(pedidoData.cantidad || 0), cantidadEntregada, (fotosMercanciaUrls || []).join(", "),
          "", precioUnitario, descuento, totalLinea]);
      }
    }

    // d. Ejecutamos el batch de Firestore
    await batch.commit();

    // e. Si hay filas para añadir (porque eran de ACE), las procesamos
    if (rowsToAppend.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId, range: "Albaranes de salida!A3", valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS", resource: {values: rowsToAppend},
      });
      console.log(`${rowsToAppend.length} filas añadidas a Albaranes de salida.`);

      // f. Generamos PDF y encolamos el email
      console.log("Generando PDF para el albarán:", albaranNumero);
      const datosParaPdf = {
        numero: albaranNumero,
        logoUrl: "https://i.ibb.co/3mtQ6pTS/ACE-Colecci-n-LOGOS-Ace-store-HOR-COLOR.png",
        fecha: fechaSalida.toLocaleDateString("es-ES"),
        expediente: rowsToAppend[0][2],
        cliente: rowsToAppend[0][3],
        direccion: direccionParaPdf, // Usamos la variable que guardamos
        lineas: rowsToAppend.map((row) => ({
          marca: row[10], descripcion: row[11], cantidad: row[14], precio: row[17], descuento: row[18], total: row[19],
        })),
      };
      const pdfUrl = await generarAlbaranPDF(datosParaPdf, storage);
      console.log(`PDF generado y subido a: ${pdfUrl}`);

      await db.collection("correos").add({
        to: ["miguel@arcasl.es"],
        message: {
          subject: `Albarán de Salida Nº ${albaranNumero} - Exp: ${datosParaPdf.expediente}`,
          html: `
          <p>Se ha generado un nuevo albarán de salida.</p>
          <p>Puede descargarlo desde el siguiente enlace: 
          <a href="${pdfUrl}">Descargar Albarán ${albaranNumero}.pdf</a></p>`,
          attachments: [{filename: `Albaran_${albaranNumero}.pdf`, path: pdfUrl}],
        },
      });
      console.log("Correo para administración encolado con el PDF adjunto.");
    }

    if (receptorDni) { // Solo guardamos si se proporcionó un DNI
      const receptorRef = db.collection("receptores").doc(receptorDni);
      await receptorRef.set({
        nombre: receptorNombre,
        dni: receptorDni,
        // Podríamos añadir un contador o fecha de última vez
        ultimoUso: fechaSalida,
      }, {merge: true}); // Usamos merge:true para no sobrescribir otros datos si ya existe
    }

    // g. Devolvemos el resultado final
    return {
      success: true, message: "Salida registrada y albarán generado correctamente.",
      albaranNumero: albaranNumero,
    };
  } catch (error) {
    console.error("Error al procesar el batch de salida o al escribir en Sheets:", error);
    throw new HttpsError("internal", "No se pudo registrar la salida de mercancía.");
  }
});

/**
 * Función que obtiene la lista de productos habituales con todos sus detalles.
 */
exports.getHabitualesConDetalles = onCall({
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError(
        "unauthenticated", "El usuario debe estar autenticado.");
  }

  try {
    const db = getFirestore();
    const auth = new google.auth.GoogleAuth({
      keyFile: "service-account-key.json",
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({version: "v4", auth});

    // 1. Obtener la lista de productos habituales
    const habitualesConfig =
      await db.collection("config").doc("productosHabituales").get();
    if (!habitualesConfig.exists) {
      throw new HttpsError(
          "not-found",
          "No se encontró la configuración de productos habituales.");
    }
    const productosHabituales = habitualesConfig.data().lista || [];

    // 2. Agrupar productos por marca para optimizar las llamadas
    const productosPorMarca = new Map();
    productosHabituales.forEach((p) => {
      if (!productosPorMarca.has(p.marca)) {
        productosPorMarca.set(p.marca, []);
      }
      productosPorMarca
          .get(p.marca).push({codigo: p.codigo, imagenUrl: p.imagenUrl});
    });

    // 3. Obtener todas las marcas para buscar sus idHoja
    const marcasSnapshot = await db.collection("marcas").get();
    const marcasMap = new Map(
        marcasSnapshot.docs.map((doc) => [doc.id, doc.data()]));

    const productosDetallados = [];
    const promesasLectura = [];

    // 4. Por cada MARCA, hacemos UNA SOLA llamada a la API
    for (const [marcaNombre,
      productosDeLaMarca] of productosPorMarca.entries()) {
      const marcaInfo = marcasMap.get(marcaNombre);
      if (!marcaInfo || !marcaInfo.idHoja) {
        console.warn(`No se encontró tarifa para la marca: ${marcaNombre}`);
        continue;
      }

      // Creamos una promesa para leer la hoja de esta marca
      const promesa = sheets.spreadsheets.values.get({
        spreadsheetId: marcaInfo.idHoja,
        range: "A2:H",
      }).then((response) => {
        const tarifaRows = response.data.values || [];
        const codigosABuscar = new Set(productosDeLaMarca.map((p) => p.codigo));

        // Buscamos los productos en la tarifa ya descargada
        tarifaRows.forEach((row) => {
          const codigoEnTarifa = row[0];
          if (codigosABuscar.has(codigoEnTarifa)) {
            const habitualOriginal =
              productosDeLaMarca.find((p) => p.codigo === codigoEnTarifa);
            const precioBase =
              parseFloat(String(row[5] || "0").replace(",", ".")) || 0;

            productosDetallados.push({
              codigo: codigoEnTarifa,
              descripcion: row[1] || "",
              marca: marcaNombre,
              imagenUrl: habitualOriginal.imagenUrl,
              precioVenta: precioBase * (marcaInfo.multiplicadorPV || 1),
              unidadVenta: row[6] || "ud",
            });
          }
        });
      });
      promesasLectura.push(promesa);
    }

    // 5. Esperamos a que todas las lecturas de hojas terminen
    await Promise.all(promesasLectura);

    console.log(`
      Se retornaron ${productosDetallados.length}
      productos habituales con detalles.`);
    return {productos: productosDetallados};
  } catch (error) {
    console.error("Error en getHabitualesConDetalles:", error);
    throw new HttpsError(
        "internal", "No se pudieron cargar los detalles de los productos.");
  }
});

/**
 * Registra una Salida Rápida. Agrupa las líneas por expediente y genera
 * un albarán y un PDF único para cada uno, encolando un email a administración.
 */
exports.registrarSalidaRapida = onCall({
  timeoutSeconds: 120, // Aumentamos el tiempo de espera a 2 minutos
  memory: "1GiB", // Aumentamos la memoria a 1 GB
}, async (request) => {
  const db = getFirestore();
  const storage = getStorage();

  // 1. --- Autenticación y Validación de Datos ---
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "El usuario debe estar autenticado.");
  }
  const usuarioEmail = request.auth.token.email;

  const {
    lineasSalida,
    receptorNombre,
    receptorDni,
    firmaDataUrl,
    fotosMercanciaUrls,
  } = request.data;

  if (!lineasSalida || !Array.isArray(lineasSalida) || lineasSalida.length === 0) {
    throw new HttpsError("invalid-argument", "No se proporcionaron líneas de salida válidas.");
  }
  if (!receptorNombre || !firmaDataUrl) {
    throw new HttpsError("invalid-argument", "Faltan datos del receptor o la firma para la salida rápida.");
  }

  // 2. --- Operaciones Comunes (Firma) ---
  const firmaUrl = await (async () => {
    try {
      const matches = firmaDataUrl.match(/^data:(.+);base64,(.+)$/);
      const contentType = matches[1];
      const imageBuffer = Buffer.from(matches[2], "base64");
      const filePath = `firmas-salida/salida-rapida-${Date.now()}.png`;
      const file = storage.bucket().file(filePath);
      await file.save(imageBuffer, {metadata: {contentType, cacheControl: "public, max-age=31536000"}});
      await file.makePublic();
      return file.publicUrl();
    } catch (err) {
      throw new HttpsError("internal", "No se pudo procesar y guardar la firma.", err);
    }
  })();

  // 3. --- Agrupación de Líneas por Expediente ---
  const salidasPorExpediente = {};
  for (const linea of lineasSalida) {
    const expediente = linea.expediente || "SIN EXPEDIENTE";
    if (!salidasPorExpediente[expediente]) {
      salidasPorExpediente[expediente] = [];
    }
    salidasPorExpediente[expediente].push(linea);
  }

  // 4. --- Lógica de Negocio ---
  const batch = db.batch();
  const fechaSalida = new Date();
  const rowsToAppend = []; // Para Google Sheets
  const albaranesParaPdf = []; // Para generar los PDFs después

  const day = String(fechaSalida.getDate()).padStart(2, "0");
  const month = String(fechaSalida.getMonth() + 1).padStart(2, "0");
  const year = fechaSalida.getFullYear();
  const fechaEntregaFormateada = `${day}-${month}-${year}`;

  const auth = new google.auth.GoogleAuth({
    keyFile: "service-account-key.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({version: "v4", auth});
  const spreadsheetId = "1w0hHnLTe-p3qfz3tW6ngXMcHa1etm3gSNPudCoGD49w";

  try {
    // --- Bucle Principal: uno por cada expediente ---
    // eslint-disable-next-line guard-for-in
    for (const expediente in salidasPorExpediente) {
      const lineasDelExpediente = salidasPorExpediente[expediente];
      const albaranNumero = await db.runTransaction(async (t) => {
        const contadorRef = db.collection("contadores").doc("albaranSalida");
        const anoActual = new Date().getFullYear().toString().slice(-2);
        const contadorDoc = await t.get(contadorRef);
        let nuevoNumero;
        const nuevoAno = parseInt(anoActual);
        if (!contadorDoc.exists) {
          nuevoNumero = 1;
          t.set(contadorRef, {numero: nuevoNumero, ano: nuevoAno});
        } else {
          const datosContador = contadorDoc.data();
          nuevoNumero = (datosContador.ano !== nuevoAno) ? 1 : datosContador.numero + 1;
          t.update(contadorRef, {numero: nuevoNumero, ano: nuevoAno});
        }
        return `ABS${String(nuevoNumero).padStart(4, "0")}-${nuevoAno}`;
      });

      const filasDelAlbaran = [];

      for (const linea of lineasDelExpediente) {
        const pedidoRef = db.collection("pedidos").doc();
        const cantidad = parseFloat(linea.cantidad || 0);
        const precioUnitario = parseFloat(linea.precioVenta || 0);
        const descuento = parseFloat(linea.descuento || 0);
        const totalLinea = cantidad * precioUnitario * (1 - descuento);

        const datosPedido = {
          expediente: expediente,
          proveedor: "ALMACÉN (Salida Directa)",
          marca: linea.marca || "",
          codigo: linea.codigo || "",
          descripcion: linea.descripcion || "",
          bultos: linea.bultos || "", cantidad: cantidad, precioUnitario: precioUnitario,
          dtoPresupuesto: descuento, importe: totalLinea, unidadVenta: linea.unidadVenta || "ud",
          referenciaEspecifica: linea.referenciaEspecifica || "",
          fechaCreacion: fechaSalida, fechaEntrega: fechaEntregaFormateada,
          usuarioEmail: usuarioEmail, necesitaAlmacen: true,
          estado: "Enviado Completo", observaciones: linea.observaciones || "",
        };
        batch.set(pedidoRef, datosPedido);

        const movimientoRef = pedidoRef.collection("movimientos").doc();
        batch.set(movimientoRef, {
          tipo: "salida", fecha: fechaSalida, cantidadEnviada: cantidad,
          usuario: usuarioEmail, albaranNumero: albaranNumero,
          receptor: {nombre: receptorNombre, dni: receptorDni || ""},
          firmaUrl: firmaUrl, fotosMercanciaUrls: fotosMercanciaUrls || [],
        });

        const filaParaSheet = ["", "", expediente, usuarioEmail, albaranNumero, fechaSalida.toLocaleDateString("es-ES"),
          receptorNombre, firmaUrl, pedidoRef.id, datosPedido.referenciaEspecifica,
          datosPedido.marca, datosPedido.descripcion,
          datosPedido.bultos, cantidad, cantidad,
          (fotosMercanciaUrls || []).join(", "), "", precioUnitario, descuento, totalLinea];

        rowsToAppend.push(filaParaSheet);
        filasDelAlbaran.push(filaParaSheet);
      }

      // Guardamos la información agrupada para generar el PDF más tarde
      albaranesParaPdf.push({
        numero: albaranNumero,
        expediente: expediente,
        direccion: lineasDelExpediente[0].direccion || "", // Asumimos que la dirección puede venir en la línea
        filas: filasDelAlbaran,
      });
    }

    // e. Ejecutamos el batch de Firestore
    await batch.commit();

    // f. Enviamos las filas a Google Sheets
    if (rowsToAppend.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId, range: "Albaranes de salida!A3", valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS", resource: {values: rowsToAppend},
      });
    }

    // g. Generamos los PDFs y encolamos los correos
    for (const albaran of albaranesParaPdf) {
      const datosParaPdf = {
        numero: albaran.numero,
        logoUrl: "https://i.ibb.co/3mtQ6pTS/ACE-Colecci-n-LOGOS-Ace-store-HOR-COLOR.png",
        fecha: fechaSalida.toLocaleDateString("es-ES"),
        expediente: albaran.expediente,
        cliente: usuarioEmail, // En salida rápida, el cliente es el propio usuario
        direccion: albaran.direccion,
        lineas: albaran.filas.map((row) => ({
          marca: row[10], descripcion: row[11], cantidad: row[14], precio: row[17], descuento: row[18], total: row[19],
        })),
      };

      const pdfUrl = await generarAlbaranPDF(datosParaPdf, storage);
      console.log(`PDF para albarán ${albaran.numero} generado y subido a: ${pdfUrl}`);

      await db.collection("correos").add({
        to: ["miguel@arcasl.es"],
        message: {
          subject: `Albarán de Salida Rápida Nº ${albaran.numero} - Exp: ${albaran.expediente}`,
          html: `
          <p>Se ha generado un nuevo albarán de salida rápida.</p>
          <p>Puede descargarlo desde el siguiente enlace: 
          <a href="${pdfUrl}">Descargar Albarán ${albaran.numero}.pdf</a></p>`,
          attachments: [{filename: `Albaran_${albaran.numero}.pdf`, path: pdfUrl}],
        },
      });
      console.log(`Correo para albarán ${albaran.numero} encolado.`);
    }

    if (receptorDni) { // Solo guardamos si se proporcionó un DNI
      const receptorRef = db.collection("receptores").doc(receptorDni);
      await receptorRef.set({
        nombre: receptorNombre,
        dni: receptorDni,
        // Podríamos añadir un contador o fecha de última vez
        ultimoUso: fechaSalida,
      }, {merge: true}); // Usamos merge:true para no sobrescribir otros datos si ya existe
    }

    // h. Devolvemos el resultado final
    return {
      success: true,
      message: "Salida rápida registrada. Se han generado varios albaranes.",
      albaranesGenerados: albaranesParaPdf.map((a) => a.numero),
    };
  } catch (error) {
    console.error("Error al procesar la salida rápida por expedientes:", error);
    throw new HttpsError("internal", "No se pudo registrar la salida rápida.");
  }
});

/**
 * Genera un PDF de albarán a partir de datos, lo sube a Storage y devuelve la URL.
 * @param {object} datosAlbaran - Objeto con toda la información para el PDF.
 * @param {object} storage - Instancia de Firebase Storage.
 * @return {Promise<string>} - La URL pública del PDF generado.
 */
async function generarAlbaranPDF(datosAlbaran, storage) {
  // --- 1. Preparamos el HTML del Albarán ---
  const totalDocumento = datosAlbaran.lineas.reduce((sum, linea) => sum + linea.total, 0);

  const lineasHtml = datosAlbaran.lineas.map((linea) => `
    <tr>
      <td>${linea.marca}</td>
      <td>${linea.descripcion}</td>
      <td class="num">${linea.cantidad.toFixed(2)}</td>
      <td class="num">${linea.precio.toFixed(2)} €</td>
      <td class="num">${(linea.descuento * 100).toFixed(0)}%</td>
      <td class="num">${linea.total.toFixed(2)} €</td>
    </tr>
  `).join("");

  const htmlCompleto = `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: Helvetica, Arial, sans-serif; font-size: 10px; color: #333; }
          .container { padding: 40px; }
          .header { display: flex; justify-content: space-between;
          align-items: flex-start; border-bottom: 2px solid #0055a4; padding-bottom: 10px; }
          .logo { width: 150px; }
          .company-address { text-align: right; }
          .details { display: flex; justify-content: space-between; margin-top: 20px; padding: 10px;
          background-color: #f5f5f5; border-radius: 5px;}
          h1 { color: #0055a4; margin-bottom: 20px; font-size: 24px;}
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border: 1px solid #ddd; padding: 6px; text-align: left; }
          th { background-color: #eef; }
          .total-row { font-weight: bold; background-color: #f5f5f5;}
          .num { text-align: right; }
          .footer { text-align: right; margin-top: 30px; font-size: 14px; font-weight: bold;}
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <img src="${datosAlbaran.logoUrl}" alt="Logo" class="logo"/>
            <div class="company-address">
              <strong>ACE Distribución</strong><br>
              Calle Galena, 13<br>
              47012 Valladolid
            </div>
          </div>
          <h1>Albarán de Salida</h1>
          <div class="details">
            <div>
              <strong>Expediente:</strong> ${datosAlbaran.expediente}<br>
              <strong>Dirección:</strong> ${datosAlbaran.direccion || "No especificada"}
            </div>
            <div>
              <strong>Nº Albarán:</strong> ${datosAlbaran.numero}<br>
              <strong>Fecha:</strong> ${datosAlbaran.fecha}
            </div>
            <div>
              <strong>Cliente:</strong><br>
              ${datosAlbaran.cliente}
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Marca</th>
                <th>Descripción</th>
                <th class="num">Cantidad</th>
                <th class="num">Precio</th>
                <th class="num">Dto.</th>
                <th class="num">Total</th>
              </tr>
            </thead>
            <tbody>
              ${lineasHtml}
              <tr class="total-row">
                <td colspan="5" class="num">TOTAL</td>
                <td class="num">${totalDocumento.toFixed(2)} €</td>
              </tr>
            </tbody>
          </table>
          <div class="footer">
             Recibido y conforme
          </div>
        </div>
      </body>
    </html>
  `;

  // --- 2. Lanzamos Puppeteer y generamos el PDF ---
  let browser = null;
  let pdfBuffer;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(), // La única diferencia es el paréntesis () aquí
      headless: chromium.headless,
    });
    const page = await browser.newPage();
    await page.setContent(htmlCompleto, {waitUntil: "networkidle0"});
    pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {top: "20px", right: "20px", bottom: "20px", left: "20px"},
    });
  } finally {
    if (browser !== null) {
      await browser.close();
    }
  }

  // --- 3. Subimos el PDF a Storage ---
  const filePath = `albaranes-pdf/${datosAlbaran.numero}.pdf`;
  const file = storage.bucket().file(filePath);
  await file.save(pdfBuffer, {metadata: {contentType: "application/pdf"}});
  await file.makePublic();
  return file.publicUrl();
}
