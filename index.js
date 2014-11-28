var precinct = require('precinct');
var q = require('q');
var path = require('path');
var fs = require('fs');
var amdModuleLookup = require('module-lookup-amd');

/**
 * Recursively find all dependencies (avoiding circular) until travering the entire dependency tree
 * and return a flat list of all nodes
 *
 * @param {Object} options
 * @param {String} options.filename - The path of the module whose tree to traverse
 * @param {String} options.root - The directory containing all JS files
 * @param {Function} options.success - Executed with the list of files in the dependency tree
 * @param {Object} [options.visited] - Cache of visited, absolutely pathed files that should not be reprocessed.
 *                                   Used for memoization.
 *                                   Format is a filename -> true lookup table
 * @param {String} [options.config] - RequireJS config file (for aliased dependency paths)
 */
module.exports.getTreeAsList = function(options) {
  var filename = options.filename;
  var root = options.root;
  var cb = options.success;
  var visited = options.visited || {};
  var config = options.config;

  if (!filename) { throw new Error('filename not given'); }
  if (!root) { throw new Error('root not given'); }
  if (!cb) { throw new Error('callback not given'); }

  filename = path.resolve(process.cwd(), filename);

  if (visited[filename] || !fs.existsSync(filename)) {
    cb([]);
    return;
  }

  visited[filename] = true;

  var results = [filename];

  function traverse(filename, root) {
    var dependencies;
    var content;

    try {
      content = fs.readFileSync(filename, 'utf8');

      if (isSassFile(filename)) {
        dependencies = precinct(content, 'sass');
      } else {
        dependencies = precinct(content);
      }
    } catch (e) {
      console.log('cannot read: ', filename)
      dependencies = [];
    }

    if (dependencies.length) {
      if (config) {
        dependencies = dependencies.map(function(dependency) {
          return amdModuleLookup(config, dependency);
        });
      } else {
        dependencies = avoidLoaders(dependencies);
      }

      dependencies = resolveFilepaths(dependencies, filename, root);
      dependencies = avoidDuplicates(dependencies, visited);
    }

    results = results.concat(dependencies);

    return q.all(dependencies.map(function(dep) {
      return traverse(dep, root);
    }));
  }

  traverse(filename, root).then(function() {
    cb(results);
  });
};

/**
 * @param  {String[]} dependencies - dependencies of the given filename
 * @param  {String} filename
 * @param  {String} root
 * @return {String[]}
 */
function resolveFilepaths(dependencies, filename, root) {
  return dependencies.map(function(dep) {
    var depDir = path.dirname(filename);
    var fileExt = path.extname(filename);
    var depExt = path.extname(dep);

    // Relative paths are about current file, non-relative are about the root
    if (dep.indexOf('..') === 0 || dep.indexOf('.') === 0) {
      dep = path.resolve(path.dirname(filename), dep);

    } else {
      dep = path.resolve(root, dep);
    }

    // Adopt the current file's extension
    if (isSassFile(filename) && !depExt && depExt !== fileExt) {
      dep += fileExt;

    // Default to js
    } else if (fileExt === '.js') {
      dep += '.js';
    }

    return dep;
  });
}

/**
 * Note: mutates the cache to note dependencies that were not visited but will be
 * @param  {String[]} dependencies
 * @param  {Object} cache        - A lookup table of visited nodes
 * @return {String[]}
 */
function avoidDuplicates(dependencies, cache) {
  return dependencies.filter(function(dep) {
    var wasVisited = !!cache[dep];

    if (!wasVisited) {
      cache[dep] = true;
    }

    return !wasVisited;
  });
}

/**
 * Returns a list of dependencies that do not include requirejs loaders (like hogan, text, and css)
 * @param  {String[]} dependencies
 * @return {String[]}
 */
function avoidLoaders(dependencies) {
  var avoided = [
    'hgn!',
    'css!',
    'txt!'
  ];
  var pattern = new RegExp(avoided.join('|'));

  return dependencies.filter(function(dep) {
    return !pattern.test(dep);
  });
}

/**
 * @param  {String}  filename
 * @return {Boolean}
 */
function isSassFile(filename) {
  return path.extname(filename) === '.sass' ||
         path.extname(filename) === '.scss';
}
