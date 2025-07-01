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
        // unidad_venta: row[6] || "", // Descomentar si se necesitan
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
