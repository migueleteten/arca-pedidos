// functions/index.js

const {onRequest} = require("firebase-functions/v2/https");
const {google} = require("googleapis");
const {setGlobalOptions} = require("firebase-functions/v2");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");

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
          linea.cantidad,
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
                              <td>${linea.observaciones || ""}</td>
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
 * Registra las líneas de una salida rápida
 * como nuevos pedidos en estado 'Enviado a Obra'.
 */
exports.registrarSalidaRapida = onCall({
}, async (request) => {
  // 1. Verificación de autenticación y argumentos
  if (!request.auth) {
    throw new HttpsError(
        "unauthenticated", "El usuario debe estar autenticado.");
  }
  const {lineasSalida} = request.data;
  if (!lineasSalida ||
    !Array.isArray(lineasSalida) ||
    lineasSalida.length === 0) {
    throw new HttpsError(
        "invalid-argument",
        "No se han proporcionado líneas de salida válidas.");
  }

  const usuarioEmail = request.auth.token.email;
  const db = getFirestore();
  // Usamos un lote para guardar todas las líneas a la vez
  const batch = db.batch();

  console.log(`
    Registrando salida rápida de ${usuarioEmail}
    con ${lineasSalida.length} líneas.`);

  lineasSalida.forEach((linea) => {
    // Creamos una referencia a un nuevo documento en la colección 'pedidos'
    const pedidoRef = db.collection("pedidos").doc();

    /* Construimos el objeto a guardar,
    asegurándonos de que todos los campos necesarios están*/
    const datosAGuardar = {
      expediente: linea.expediente || "SIN EXPEDIENTE",
      // No tenemos este dato en la salida rápida, se puede dejar vacío
      direccion: "",
      // Proveedor especial para identificar estas salidas
      proveedor: "ALMACÉN (Salida Directa)",
      marca: linea.marca,
      codigo: linea.codigo,
      descripcion: linea.descripcion,
      bultos: 0, // No aplica
      cantidad: linea.cantidad,
      precioUnitario: linea.precioVenta,
      importe: linea.cantidad * linea.precioVenta,
      unidadVenta: linea.unidadVenta || "ud",
      // Usamos la fecha actual como fecha de pedido/salida
      fechaCreacion: new Date(),
      fechaEntrega: new Date(),
      usuarioEmail: usuarioEmail,
      // true porque tiene que verlo el usuario almacenero
      necesitaAlmacen: true,
      estado: "Enviado a Obra", // Estado final directo
      observaciones: linea.observaciones || "",
    };

    // Añadimos la operación de creación al lote
    batch.set(pedidoRef, datosAGuardar);
  });

  try {
    // Ejecutamos todas las operaciones de guardado a la vez
    await batch.commit();
    console.log(`Salida rápida de ${usuarioEmail} guardada con éxito.`);
    return {success: true, message: "Salida registrada correctamente."};
  } catch (error) {
    console.error("Error al registrar la salida rápida en Firestore:", error);
    throw new HttpsError("internal", "No se pudo registrar la salida.");
  }
});
