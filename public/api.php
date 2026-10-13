<?php
/**
 * REST API for MMP-CWC
 * Handles requests from React frontend and interacts with Hostinger MySQL Database.
 * Formats responses to mimic Firestore REST API to avoid modifying the frontend.
 */

// Handle CORS
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

header("Content-Type: application/json");

// Proxy Google Apps Script Web App requests to avoid browser CORS & inspect HTML error pages
if (isset($_GET['action']) && $_GET['action'] === 'gdrive_proxy' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $rawInput = file_get_contents('php://input');
    $reqData = json_decode($rawInput, true) ?: [];
    $scriptUrl = trim($reqData['scriptUrl'] ?? '');
    $payload = $reqData['payload'] ?? [];
    if (!$scriptUrl) {
        http_response_code(400);
        echo json_encode(["success" => false, "error" => "Missing scriptUrl"]);
        exit;
    }
    $ch = curl_init($scriptUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_MAXREDIRS, 5);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: text/plain;charset=utf-8']);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    $respText = curl_exec($ch);
    $curlErr = curl_error($ch);
    $finalUrl = curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
    curl_close($ch);
    if ($respText === false) {
        echo json_encode(["success" => false, "error" => "cURL error: " . $curlErr]);
        exit;
    }
    $decoded = json_decode($respText, true);
    if (is_array($decoded)) {
        echo json_encode($decoded);
        exit;
    }
    $friendly = "Google Script returned an HTML page instead of JSON.";
    if (strpos($finalUrl, 'accounts.google.com') !== false || strpos($respText, 'accounts.google.com') !== false || strpos($respText, 'ServiceLogin') !== false) {
        $friendly = "Access Denied by Google: In script.google.com, click Deploy -> Manage deployments -> Edit -> set 'Who has access' to 'Anyone' and click Deploy.";
    } elseif (strpos($respText, 'Authorization is required') !== false || strpos($respText, 'permission') !== false || strpos($respText, 'DriveApp') !== false) {
        $friendly = "Drive Permission Needed: In script.google.com editor, click 'Run' at the top toolbar once and click 'Review Permissions -> Advanced -> Allow', then Deploy -> Manage deployments -> Edit -> Version: 'New version' -> Deploy.";
    }
    echo json_encode(["success" => false, "error" => $friendly]);
    exit;
}

// Delete a single file from /uploads/
if (isset($_GET['action']) && $_GET['action'] === 'delete') {
    $upload_dir = __DIR__ . '/uploads/';
    $name = $_GET['name'] ?? null;
    if (!$name) {
        $raw = json_decode(file_get_contents('php://input'), true);
        $name = $raw['name'] ?? null;
    }
    if (!$name) {
        http_response_code(400);
        echo json_encode(["success" => false, "error" => "No file name provided"]);
        exit;
    }
    $name = str_replace(['..', '\\'], '', $name);
    $name = preg_replace('#^/?uploads/#', '', ltrim($name, '/'));
    $target_file = $upload_dir . ltrim($name, '/');

    if (file_exists($target_file) && is_file($target_file)) {
        @unlink($target_file);
        echo json_encode(["success" => true, "deleted" => $name]);
    } else {
        echo json_encode(["success" => true, "deleted" => false, "message" => "File already removed"]);
    }
    exit;
}

// Clean orphan files inside a subfolder of /uploads/
if (isset($_GET['action']) && $_GET['action'] === 'clean_folder') {
    $upload_dir = __DIR__ . '/uploads/';
    $raw = json_decode(file_get_contents('php://input'), true) ?: [];
    $folder = $_GET['folder'] ?? ($raw['folder'] ?? '');
    $keepFiles = $raw['keepFiles'] ?? [];
    $folder = str_replace(['..', '\\'], '', $folder);
    $folder = trim($folder, '/');

    if (!$folder) {
        http_response_code(400);
        echo json_encode(["success" => false, "error" => "No folder specified"]);
        exit;
    }

    $target_dir = $upload_dir . $folder;
    $deleted = [];
    if (is_dir($target_dir)) {
        $items = scandir($target_dir);
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') continue;
            $full = $target_dir . '/' . $item;
            if (is_file($full) && !in_array($item, $keepFiles, true)) {
                if (@unlink($full)) {
                    $deleted[] = $item;
                }
            }
        }
    }
    echo json_encode(["success" => true, "deletedCount" => count($deleted), "deletedFiles" => $deleted]);
    exit;
}

// ==========================================
// DATABASE CONFIGURATION (HOSTINGER MYSQL)
// ==========================================
$db_host = 'localhost';
$db_name = 'u485225710_community';
$db_user = 'u485225710_admin'; // UPDATE THIS IN HOSTINGER
$db_pass = 'Pindia@2025'; // UPDATE THIS IN HOSTINGER

try {
    $pdo = new PDO("mysql:host=$db_host;dbname=$db_name;charset=utf8mb4", $db_user, $db_pass);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(["error" => "Database connection failed. Please check credentials."]);
    exit;
}

// Ensure tables exist (using a simple Document Store model: id (VARCHAR) + data (JSON))
$tables = ['config', 'users', 'registrations', 'contacts', 'donations', 'volunteers', 'template_assets'];
foreach ($tables as $table) {
    $pdo->exec("CREATE TABLE IF NOT EXISTS `$table` (
        `id` VARCHAR(191) PRIMARY KEY,
        `data` LONGTEXT
    )");
}

// Parse the route
$request_uri = $_SERVER['REQUEST_URI'] ?? '';
$path = parse_url($request_uri, PHP_URL_PATH);
// Extract path after api.php/
$prefix = '/api.php/';
$route = '';
if (strpos($path, $prefix) !== false) {
    $route = substr($path, strpos($path, $prefix) + strlen($prefix));
} else {
    // If running via rewrite rules
    $route = ltrim($path, '/');
}

$parts = explode('/', trim($route, '/'));
$collection = $parts[0] ?? '';
$docId = $parts[1] ?? '';

// We map 'content/main' to collection 'config', id 'main'
if ($collection === 'content' && $docId === 'main') {
    $collection = 'config';
    $docId = 'main';
}

if (!$collection || !in_array($collection, $tables)) {
    http_response_code(404);
    echo json_encode(["error" => "Collection not found or invalid."]);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];
$inputJSON = file_get_contents('php://input');
$input = json_decode($inputJSON, true);

// Helper to convert PHP array to Firestore format
function arrayToFirestoreFields($array) {
    $fields = [];
    foreach ($array as $key => $value) {
        if (is_int($value)) {
            $fields[$key] = ['integerValue' => (string)$value];
        } elseif (is_bool($value)) {
            $fields[$key] = ['booleanValue' => $value];
        } elseif (is_array($value)) {
            // Nested arrays aren't fully mapped to mapValue in this simple mock unless needed,
            // we'll serialize to string for complex objects, or attempt a mapValue
            $fields[$key] = ['stringValue' => json_encode($value)];
        } else {
            $fields[$key] = ['stringValue' => (string)$value];
        }
    }
    return $fields;
}

// Helper to convert Firestore fields to PHP array
function firestoreFieldsToArray($fields) {
    if (!isset($fields['fields'])) return $fields; // Might already be plain
    $array = [];
    foreach ($fields['fields'] as $key => $val) {
        if (isset($val['stringValue'])) $array[$key] = $val['stringValue'];
        elseif (isset($val['integerValue'])) $array[$key] = (int)$val['integerValue'];
        elseif (isset($val['booleanValue'])) $array[$key] = (bool)$val['booleanValue'];
        else $array[$key] = array_values($val)[0] ?? null;
    }
    return $array;
}


if ($method === 'GET') {
    if ($docId) {
        // Fetch single document
        $stmt = $pdo->prepare("SELECT data FROM `$collection` WHERE id = ?");
        $stmt->execute([$docId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($row) {
            $data = json_decode($row['data'], true) ?: [];
            echo json_encode([
                "name" => "projects/mmp-cwc/databases/(default)/documents/$collection/$docId",
                "fields" => arrayToFirestoreFields($data)
            ]);
        } else {
            http_response_code(404);
            echo json_encode(["error" => "NOT_FOUND"]);
        }
    } else {
        // Fetch all documents
        $stmt = $pdo->query("SELECT id, data FROM `$collection`");
        $documents = [];
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $data = json_decode($row['data'], true) ?: [];
            $documents[] = [
                "name" => "projects/mmp-cwc/databases/(default)/documents/$collection/" . $row['id'],
                "fields" => arrayToFirestoreFields($data)
            ];
        }
        echo json_encode(["documents" => $documents]);
    }
} elseif ($method === 'POST') {
    // Create new document (ID is usually generated if not provided, but Firestore REST uses POST for auto-id)
    $newId = $docId ?: uniqid();
    $dataToSave = firestoreFieldsToArray($input);
    
    $stmt = $pdo->prepare("INSERT INTO `$collection` (id, data) VALUES (?, ?)");
    $stmt->execute([$newId, json_encode($dataToSave)]);
    
    echo json_encode([
        "name" => "projects/mmp-cwc/databases/(default)/documents/$collection/$newId",
        "fields" => arrayToFirestoreFields($dataToSave)
    ]);
} elseif ($method === 'PATCH' || $method === 'PUT') {
    // Update existing document
    if (!$docId) {
        http_response_code(400);
        echo json_encode(["error" => "Document ID required for update"]);
        exit;
    }
    
    // Fetch existing
    $stmt = $pdo->prepare("SELECT data FROM `$collection` WHERE id = ?");
    $stmt->execute([$docId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    
    $existingData = $row ? json_decode($row['data'], true) : [];
    $updateData = firestoreFieldsToArray($input);
    
    $mergedData = array_merge($existingData, $updateData);
    
    if ($row) {
        $stmt = $pdo->prepare("UPDATE `$collection` SET data = ? WHERE id = ?");
        $stmt->execute([json_encode($mergedData), $docId]);
    } else {
        $stmt = $pdo->prepare("INSERT INTO `$collection` (id, data) VALUES (?, ?)");
        $stmt->execute([$docId, json_encode($mergedData)]);
    }
    
    echo json_encode([
        "name" => "projects/mmp-cwc/databases/(default)/documents/$collection/$docId",
        "fields" => arrayToFirestoreFields($mergedData)
    ]);
} elseif ($method === 'DELETE') {
    if ($docId) {
        $stmt = $pdo->prepare("DELETE FROM `$collection` WHERE id = ?");
        $stmt->execute([$docId]);
        echo json_encode(["success" => true]);
    } else {
        http_response_code(400);
        echo json_encode(["error" => "Document ID required for delete"]);
    }
}
