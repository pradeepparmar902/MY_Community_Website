<?php
/**
 * File Upload & Cleanup Handler for Hostinger
 * Supports:
 * 1. POST ?name=dev/photo_gallery/file.jpg           -> Upload / overwrite file
 * 2. POST/DELETE ?action=delete&name=dev/...         -> Delete specific file from /uploads/
 * 3. POST ?action=clean_folder&folder=dev/photo_gallery -> Delete all files in folder not in keep[] list
 */

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

header("Content-Type: application/json");

$upload_dir = __DIR__ . '/uploads/';
$action = $_GET['action'] ?? '';

// 1. Delete a single file from /uploads/
if ($_SERVER['REQUEST_METHOD'] === 'DELETE' || $action === 'delete') {
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

// 2. Clean orphan files inside a subfolder (e.g. dev/photo_gallery)
if ($action === 'clean_folder') {
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

// 3. Default: Upload file
$name = $_GET['name'] ?? null;
if (!$name) {
    http_response_code(400);
    echo json_encode(["error" => "No file name provided"]);
    exit;
}

// Security: Prevent directory traversal
$name = str_replace(['..', '\\'], '', $name);
$target_file = $upload_dir . ltrim($name, '/');

// Ensure the directory exists
$dir = dirname($target_file);
if (!file_exists($dir)) {
    mkdir($dir, 0755, true);
}

// Read raw data from request body
$input = fopen('php://input', 'r');
$fp = fopen($target_file, 'w');

if (!$input || !$fp) {
    http_response_code(500);
    echo json_encode(["error" => "Unable to write file"]);
    exit;
}

while ($data = fread($input, 1024)) {
    fwrite($fp, $data);
}

fclose($input);
fclose($fp);

echo json_encode([
    "name" => $name,
    "downloadTokens" => "mock-token-" . time()
]);
